"""Tests for account provisioning and identity/password lifecycle (Phase D).

Covers: provisioning module helpers, password change/reset endpoints,
must_change_password exposure, login provisioning-flag round-trip, and the
server-side first-login gate (MustChangePasswordGateMiddleware).
"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from apps.academics.models import (
    Semester,
    SemesterStatus,
    Section,
    StudentStatus,
    TeacherStatus,
)
from apps.accounts.models import ExpiringToken, Role
from apps.accounts.provisioning import (
    ACTION_ACCOUNT_EXISTS,
    ACTION_CONFLICT,
    ACTION_NO_ACCOUNT,
    ACTION_PROVISION,
    initial_password,
    compute_account_action,
    provision_account,
    index_users,
    username_for,
    account_eligible,
)
from apps.students.models import Student
from apps.teachers.models import Teacher


# ---------------------------------------------------------------------------
# Provisioning helpers — pure unit tests
# ---------------------------------------------------------------------------

class ProvisioningHelpersTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.semester = Semester.objects.create(
            code="SEM-PROV", name="Prov", academic_year="2025-2026",
            start_date="2026-01-01", end_date="2026-05-01",
            status=SemesterStatus.ACTIVE,
        )
        self.section = Section.objects.create(
            semester=self.semester, name="A", capacity=5
        )
        self.student = Student.objects.create(
            student_id="ST1001", name="Alice", email="alice@prov.local",
            roll_no="01", section=self.section, semester=self.semester,
            status=StudentStatus.ACTIVE,
        )
        self.teacher = Teacher.objects.create(
            teacher_id="TCH-101", name="Bob", email="bob@prov.local",
            status=TeacherStatus.ACTIVE,
        )
        self.admin_user = User.objects.create_user(
            username="admin", email="admin@prov.local",
            password="Passw0rd!", role=Role.ADMIN,
        )

    def test_initial_password_formula(self):
        self.assertEqual(initial_password("ST1001"), "ST1001@123")
        self.assertEqual(initial_password("TCH-101"), "TCH-101@123")
        self.assertEqual(initial_password("id"), "id@123")

    def test_username_for_strips_whitespace(self):
        self.assertEqual(username_for("  ST1001  "), "ST1001")
        self.assertEqual(username_for(""), "")

    def test_account_eligible_active_only(self):
        self.assertTrue(account_eligible(StudentStatus.ACTIVE, "students"))
        self.assertFalse(account_eligible(StudentStatus.INACTIVE, "students"))
        self.assertFalse(account_eligible(StudentStatus.GRADUATED, "students"))
        self.assertTrue(account_eligible(TeacherStatus.ACTIVE, "teachers"))
        self.assertFalse(account_eligible(TeacherStatus.INACTIVE, "teachers"))

    def test_provision_new_rows_new_account(self):
        action, _, _ = compute_account_action(
            "students", "ST2002", StudentStatus.ACTIVE,
            None, {},
        )
        self.assertEqual(action, ACTION_PROVISION)

    def test_provision_inactive_row_no_account(self):
        action, _, _ = compute_account_action(
            "students", "ST2002", StudentStatus.INACTIVE,
            None, {},
        )
        self.assertEqual(action, ACTION_NO_ACCOUNT)

    def test_existing_account_untouched(self):
        User = get_user_model()
        linked_user = User.objects.create_user(
            username=self.teacher.teacher_id, email=self.teacher.email,
            password="Passw0rd!", role=Role.TEACHER,
        )
        linked_user.teacher_profile = self.teacher
        linked_user.save(update_fields=["teacher_profile"])

        _, users_by_teacher, _ = index_users()
        linked = users_by_teacher.get(self.teacher.pk)
        self.assertIsNotNone(linked)
        action, _, _ = compute_account_action(
            "teachers", self.teacher.teacher_id, TeacherStatus.ACTIVE,
            linked, {username_for("TCH-101").casefold(): linked_user},
        )
        self.assertEqual(action, ACTION_ACCOUNT_EXISTS)

    def test_cross_type_username_collision_blocks(self):
        User = get_user_model()
        other = User.objects.create_user(
            username="ST1001", email="existing@prov.local",
            password="Passw0rd!", role=Role.TEACHER,
        )
        _, _, users_by_student = index_users()
        linked = users_by_student.get(self.student.pk)
        action, _, _ = compute_account_action(
            "students", self.student.student_id, StudentStatus.ACTIVE,
            linked, {username_for("ST1001").casefold(): other},
        )
        self.assertEqual(action, ACTION_CONFLICT)

    def test_linked_user_is_linked(self):
        User = get_user_model()
        user = User.objects.create_user(
            username="TCH-101", email="bob@prov.local",
            password="Passw0rd!", role=Role.TEACHER,
        )
        user.teacher_profile = self.teacher
        user.save(update_fields=["teacher_profile"])

        _, users_by_teacher, _ = index_users()
        linked = users_by_teacher.get(self.teacher.pk)
        action, username, _ = compute_account_action(
            "teachers", self.teacher.teacher_id, TeacherStatus.ACTIVE,
            linked, {username_for("TCH-101").casefold(): user},
        )
        self.assertEqual(action, ACTION_ACCOUNT_EXISTS)
        self.assertEqual(username, "TCH-101")

    def test_provision_account_links_profile(self):
        User = get_user_model()
        provision_account(
            self.student, "students",
            {"student_id": "ST1001", "email": "alice@prov.local",
             "name": "Alice"},
        )
        user = User.objects.get(username="ST1001")
        self.assertEqual(user.student_profile.pk, self.student.pk)
        self.assertEqual(user.role, Role.STUDENT)
        self.assertTrue(user.is_active)
        self.assertTrue(user.must_change_password)
        self.assertTrue(user.check_password(initial_password("ST1001")))


# ---------------------------------------------------------------------------
# Auth endpoint tests (password lifecycle + me)
# ---------------------------------------------------------------------------

class AuthPasswordLifecycleTests(APITestCase):
    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.admin = User.objects.create_user(
            username="admin", email="admin@lifecycle.local",
            password="Passw0rd!", role=Role.ADMIN,
        )
        self.teacher = User.objects.create_user(
            username="tch-lc", email="teacher@lifecycle.local",
            password="Passw0rd!", role=Role.TEACHER,
        )
        self.student = User.objects.create_user(
            username="std-lc", email="student@lifecycle.local",
            password="Passw0rd!", role=Role.STUDENT,
        )

    def _token(self, user):
        return "Token " + ExpiringToken.issue_for(user).key

    def _login(self, username, password="Passw0rd!"):
        return self.client.post(
            "/api/auth/login/",
            {"username": username, "password": password},
            format="json",
        )

    def test_me_exposes_must_change_password(self):
        self.student.must_change_password = True
        self.student.save(update_fields=["must_change_password"])

        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.student))
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["must_change_password"])

    def test_login_returns_must_change_password(self):
        self.student.must_change_password = True
        self.student.save(update_fields=["must_change_password"])

        response = self._login("std-lc")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["user"]["must_change_password"])

    def test_password_change_wrong_current_400(self):
        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.admin))
        response = self.client.post(
            "/api/auth/password/change/",
            {"current_password": "wrong", "new_password": "New-Strong!Pass123"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "current_password_incorrect")

    def test_password_change_weak_new_400(self):
        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.admin))
        response = self.client.post(
            "/api/auth/password/change/",
            {"current_password": "Passw0rd!", "new_password": "12345678"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_password_change_success_clears_flag_rotates_token(self):
        self.student.must_change_password = True
        self.student.save(update_fields=["must_change_password"])

        old_token = self._token(self.student)
        self.client.credentials(HTTP_AUTHORIZATION=old_token)

        response = self.client.post(
            "/api/auth/password/change/",
            {"current_password": "Passw0rd!",
             "new_password": "Better-New!Pass2026"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        new_token = response.data["token"]
        self.assertNotEqual(old_token, f"Token {new_token}")
        self.assertFalse(response.data["user"]["must_change_password"])

        # Old token was revoked
        self.client.credentials(HTTP_AUTHORIZATION=old_token)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

        # New token works
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {new_token}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

        # Verify new password works on login (no auth header on /login/)
        logout = self.client.post("/api/auth/logout/")
        self.assertIn(logout.status_code, (204, 401))
        self.client.credentials()
        login = self._login("std-lc", "Better-New!Pass2026")
        self.assertEqual(login.status_code, 200)

    def test_admin_reset_sets_flag_and_revokes_tokens(self):
        ExpiringToken.issue_for(self.teacher)
        self.assertFalse(self.teacher.must_change_password)

        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.admin))
        response = self.client.post(
            "/api/auth/password/reset/",
            {"username": "tch-lc"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["must_change_password"])
        self.assertEqual(response.data["username"], "tch-lc")
        self.assertIsInstance(response.data, dict)
        self.assertNotIn("password", response.data)
        self.assertNotIn("token", response.data)
        self.assertNotIn(initial_password("tch-lc"), str(response.data))

        self.teacher.refresh_from_db()
        self.assertTrue(self.teacher.must_change_password)
        self.assertTrue(self.teacher.check_password(initial_password("tch-lc")))

        # Old tokens revoked
        self.assertEqual(
            Token.objects.filter(user=self.teacher).count(), 0
        )

    def test_admin_reset_by_non_admin_403(self):
        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.teacher))
        response = self.client.post(
            "/api/auth/password/reset/",
            {"username": "admin"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_reset_unknown_username_400(self):
        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.admin))
        response = self.client.post(
            "/api/auth/password/reset/",
            {"username": "no-such-user"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_password_change_unauthenticated_401(self):
        response = self.client.post(
            "/api/auth/password/change/",
            {"current_password": "Passw0rd!", "new_password": "Strong!Pass99"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)


# ---------------------------------------------------------------------------
# Server-side first-login gate (MustChangePasswordGateMiddleware)
# ---------------------------------------------------------------------------

PROTECTED_ENDPOINT = "/api/notifications/"


class MustChangePasswordGateTests(APITestCase):
    """While ``must_change_password`` is set, non-lifecycle API endpoints must
    answer 403 even with a valid token (no bypass route)."""

    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.student = User.objects.create_user(
            username="std-gate", email="student@gate.local",
            password="Passw0rd!", role=Role.STUDENT,
        )
        self.admin = User.objects.create_user(
            username="admin", email="admin@gate.local",
            password="Passw0rd!", role=Role.ADMIN,
        )

    def _token(self, user):
        return "Token " + ExpiringToken.issue_for(user).key

    def test_protected_endpoint_reachable_when_flag_cleared(self):
        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.student))
        response = self.client.get(PROTECTED_ENDPOINT)
        self.assertEqual(response.status_code, 200)

    def test_gate_blocks_protected_endpoint_with_flag_set(self):
        self.student.must_change_password = True
        self.student.save(update_fields=["must_change_password"])

        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.student))
        response = self.client.get(PROTECTED_ENDPOINT)
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertEqual(payload["code"], "must_change_password_required")

    def test_gate_allows_same_user_after_password_change(self):
        self.student.must_change_password = True
        self.student.save(update_fields=["must_change_password"])

        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.student))
        change = self.client.post(
            "/api/auth/password/change/",
            {"current_password": "Passw0rd!",
             "new_password": "Fresh-Gate!Pass2026"},
            format="json",
        )
        self.assertEqual(change.status_code, 200)
        self.assertFalse(change.data["user"]["must_change_password"])

        self.client.credentials(
            HTTP_AUTHORIZATION=f"Token {change.data['token']}"
        )
        response = self.client.get(PROTECTED_ENDPOINT)
        self.assertEqual(response.status_code, 200)

    def test_gate_exempts_me_and_password_change(self):
        self.student.must_change_password = True
        self.student.save(update_fields=["must_change_password"])

        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.student))
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)
        change = self.client.post(
            "/api/auth/password/change/",
            {"current_password": "wrong", "new_password": "Fresh-Gate!Pass2026"},
            format="json",
        )
        # Error surfaces as the serializer 400, never the 403 gate.
        self.assertEqual(change.status_code, 400)

    def test_gate_never_masks_anonymous_401(self):
        response = self.client.get(PROTECTED_ENDPOINT)
        self.assertEqual(response.status_code, 401)

    def test_gate_never_masks_invalid_token_401(self):
        self.client.credentials(HTTP_AUTHORIZATION="Token not-a-real-key")
        response = self.client.get(PROTECTED_ENDPOINT)
        self.assertEqual(response.status_code, 401)

    def test_gate_never_masks_expired_token_401(self):
        self.student.must_change_password = True
        self.student.save(update_fields=["must_change_password"])
        token = ExpiringToken.issue_for(self.student)
        token.expires_at = timezone.now() - timedelta(seconds=1)
        token.save(update_fields=["expires_at"])

        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        response = self.client.get(PROTECTED_ENDPOINT)
        self.assertEqual(response.status_code, 401)
        self.assertFalse(ExpiringToken.objects.filter(key=token.key).exists())

    def test_admin_reset_then_first_login_is_gated(self):
        User = get_user_model()
        teacher = User.objects.create_user(
            username="tch-gate", email="teacher@gate.local",
            password="Passw0rd!", role=Role.TEACHER,
        )

        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.admin))
        reset = self.client.post(
            "/api/auth/password/reset/",
            {"username": "tch-gate"},
            format="json",
        )
        self.assertEqual(reset.status_code, 200)

        self.client.credentials()
        login = self.client.post(
            "/api/auth/login/",
            {"username": "tch-gate", "password": initial_password("tch-gate")},
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        self.assertTrue(login.data["user"]["must_change_password"])

        self.client.credentials(
            HTTP_AUTHORIZATION=f"Token {login.data['token']}"
        )
        response = self.client.get(PROTECTED_ENDPOINT)
        self.assertEqual(response.status_code, 403)
        payload = response.json()
        self.assertEqual(payload["code"], "must_change_password_required")
