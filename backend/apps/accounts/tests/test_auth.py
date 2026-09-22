from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.http import HttpRequest
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from apps.academics.models import Section, Semester, SemesterStatus
from apps.accounts.models import ExpiringToken, Role
from apps.students.models import Student
from apps.teachers.models import Teacher


class AccountsApiTests(APITestCase):
    def setUp(self):
        # Isolate login-throttle counters between tests.
        cache.clear()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="admin",
            email="admin@test.local",
            password="Passw0rd!",
            name="Admin",
            role=Role.ADMIN,
        )

    def test_login_returns_token_and_user(self):
        response = self.client.post(
            "/api/auth/login/",
            {"username": "admin", "password": "Passw0rd!"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["token"])
        self.assertEqual(response.data["user"]["email"], "admin@test.local")

    def test_login_rejects_bad_password(self):
        response = self.client.post(
            "/api/auth/login/",
            {"username": "admin", "password": "wrong"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)

    def test_login_rejects_unknown_username_with_generic_401(self):
        response = self.client.post(
            "/api/auth/login/",
            {"username": "no-such-user", "password": "Passw0rd!"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
        # Generic message only — never reveal whether the username exists.
        self.assertEqual(response.data.get("detail"), "Invalid username or password.")

    def test_me_exposes_username_and_status(self):
        token = self.client.post(
            "/api/auth/login/",
            {"username": "admin", "password": "Passw0rd!"},
            format="json",
        ).data["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["username"], "admin")
        self.assertEqual(me.data["status"], "active")

    def test_deactivated_account_is_locked_out(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        login = self.client.post(
            "/api/auth/login/",
            {"username": "admin", "password": "Passw0rd!"},
            format="json",
        )
        self.assertEqual(login.status_code, 401)
        token = ExpiringToken.issue_for(self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 401)

    def test_health_is_public(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ok")


class RolePermissionsForHttpRequest:
    """Mixin to build a fake request whose user carries a given role."""

    @staticmethod
    def user_with(role):
        User = get_user_model()
        return User(username=f"{role}-user", email=f"{role}@test.local", role=role)

    @staticmethod
    def request_for(user):
        request = HttpRequest()
        request.user = user
        return request


class AuthFlowTests(APITestCase):
    """Real (non-mock) authentication flow: login -> me -> logout."""

    def setUp(self):
        # Isolate login-throttle counters between tests.
        cache.clear()
        User = get_user_model()
        self.admin = User.objects.create_user(
            username="admin",
            email="admin@flow.local",
            password="Passw0rd!",
            name="Admin",
            role=Role.ADMIN,
        )
        self.teacher_user = User.objects.create_user(
            username="tch-flow",
            email="teacher@flow.local",
            password="Passw0rd!",
            name="Teacher",
            role=Role.TEACHER,
        )
        self.teacher = Teacher.objects.create(
            teacher_id="tch-flow", name="Teacher", email=self.teacher_user.email
        )
        self.teacher_user.teacher_profile = self.teacher
        self.teacher_user.save(update_fields=["teacher_profile"])

        self.semester = Semester.objects.create(
            code="SEM-FLOW",
            name="Flow",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.section = Section.objects.create(
            semester=self.semester, name="A", capacity=5
        )
        self.student_user = User.objects.create_user(
            username="std-flow",
            email="student@flow.local",
            password="Passw0rd!",
            name="Student",
            role=Role.STUDENT,
        )
        self.student = Student.objects.create(
            student_id="std-flow",
            roll_no="01",
            name="Student",
            email=self.student_user.email,
            section=self.section,
            semester=self.semester,
        )
        self.student_user.student_profile = self.student
        self.student_user.save(update_fields=["student_profile"])

    def _login(self, username, password="Passw0rd!"):
        return self.client.post(
            "/api/auth/login/",
            {"username": username, "password": password},
            format="json",
        )

    def test_login_me_logout_cycle(self):
        response = self._login("admin")
        self.assertEqual(response.status_code, 200)
        token = response.data["token"]
        self.assertTrue(token)

        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["name"], "Admin")
        self.assertEqual(me.data["role"], "admin")
        self.assertEqual(me.data["username"], "admin")

        logout = self.client.post("/api/auth/logout/")
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(Token.objects.filter(user=self.admin).count(), 0)

        stale = self.client.get("/api/auth/me/")
        self.assertEqual(stale.status_code, 401)

    def test_teacher_logs_in_with_staff_username(self):
        teacher_me = self._login("tch-flow")
        self.assertEqual(teacher_me.status_code, 200)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Token {teacher_me.data['token']}"
        )
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.data["teacher_id"], "tch-flow")
        self.assertEqual(me.data["username"], "tch-flow")
        self.assertIsNone(me.data["student_id"])

    def test_student_logs_in_with_student_id_username(self):
        student_me = self._login("std-flow")
        self.assertEqual(student_me.status_code, 200)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Token {student_me.data['token']}"
        )
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.data["student_id"], "std-flow")
        self.assertEqual(me.data["username"], "std-flow")
        self.assertEqual(me.data["section_id"], self.section.pk)
        self.assertEqual(me.data["semester_id"], self.semester.pk)

    def test_logout_is_idempotent_for_linked_users(self):
        response = self._login("tch-flow")
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Token {response.data['token']}"
        )
        first = self.client.post("/api/auth/logout/")
        second = self.client.post("/api/auth/logout/")
        self.assertEqual(first.status_code, 204)
        self.assertEqual(second.status_code, 401)


class TokenLifecycleTests(APITestCase):
    """Expiring-token lifecycle: issuance, reuse, expiry, revocation."""

    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="tokuser",
            email="token@flow.local",
            password="Passw0rd!",
            name="Token User",
            role=Role.ADMIN,
        )

    def _login(self):
        return self.client.post(
            "/api/auth/login/",
            {"username": "tokuser", "password": "Passw0rd!"},
            format="json",
        )

    def test_login_mints_an_expiring_token(self):
        response = self._login()
        self.assertEqual(response.status_code, 200)
        token = ExpiringToken.objects.get(user=self.user)
        self.assertEqual(token.key, response.data["token"])
        self.assertIsNotNone(token.expires_at)
        self.assertFalse(token.is_expired)
        self.assertGreater(token.expires_at, timezone.now())

    def test_login_reuses_an_unexpired_token(self):
        first = self._login()
        second = self._login()
        self.assertEqual(first.data["token"], second.data["token"])

    def test_expired_token_rejected_401_and_deleted(self):
        token = ExpiringToken.issue_for(self.user)
        ExpiringToken.objects.filter(pk=token.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1)
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 401)
        self.assertEqual(ExpiringToken.objects.filter(user=self.user).count(), 0)
        self.assertEqual(Token.objects.filter(user=self.user).count(), 0)

    def test_lifetime_is_taken_from_settings(self):
        with self.settings(AAMS_TOKEN_TTL_SECONDS=3600):
            response = self._login()
        self.assertEqual(response.status_code, 200)
        token = ExpiringToken.objects.get(user=self.user)
        self.assertGreater(token.expires_at, timezone.now())
        self.assertLess(
            token.expires_at, timezone.now() + timedelta(seconds=7200)
        )

    def test_ttl_zero_disables_expiry_for_local_dev_only(self):
        with self.settings(AAMS_TOKEN_TTL_SECONDS=0):
            response = self._login()
        self.assertEqual(response.status_code, 200)
        token = ExpiringToken.objects.get(user=self.user)
        self.assertIsNone(token.expires_at)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

    def test_logout_revokes_the_expiring_token(self):
        response = self._login()
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Token {response.data['token']}"
        )
        self.assertEqual(self.client.post("/api/auth/logout/").status_code, 204)
        self.assertEqual(ExpiringToken.objects.filter(user=self.user).count(), 0)
        self.assertEqual(
            self.client.get("/api/auth/me/").status_code, 401
        )

    def test_invalid_and_missing_tokens_return_401(self):
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION="Token bogus")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_login_survives_a_legacy_orphaned_parent_token(self):
        Token.objects.create(user=self.user)
        self.assertEqual(Token.objects.filter(user=self.user).count(), 1)
        response = self._login()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ExpiringToken.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Token.objects.filter(user=self.user).count(), 1)


class LoginThrottleTests(APITestCase):
    """Login brute-force throttling (deterministic via override_settings)."""

    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="throtuser",
            email="throttle@flow.local",
            password="Passw0rd!",
            name="Throttle User",
            role=Role.ADMIN,
        )

    def _attempt(self, username="throtuser", password="wrong-password"):
        return self.client.post(
            "/api/auth/login/",
            {"username": username, "password": password},
            format="json",
        )

    def test_successful_login_is_allowed_under_normal_conditions(self):
        response = self.client.post(
            "/api/auth/login/",
            {"username": "throtuser", "password": "Passw0rd!"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_failed_attempts_are_throttled_per_account(self):
        with self.settings(
            AAMS_LOGIN_THROTTLE_RATE="3/min",
            AAMS_LOGIN_IP_THROTTLE_RATE="200/min",
        ):
            for _ in range(3):
                self.assertEqual(self._attempt().status_code, 401)
            throttled = self._attempt()
        self.assertEqual(throttled.status_code, 429)
        self.assertIn("detail", throttled.data)

    def test_ip_burst_throttle_caps_attempts_across_accounts(self):
        with self.settings(
            AAMS_LOGIN_THROTTLE_RATE="100/min",
            AAMS_LOGIN_IP_THROTTLE_RATE="3/min",
        ):
            for username in (
                "alpha",
                "bravo",
                "charlie",
            ):
                self.assertEqual(self._attempt(username).status_code, 401)
            throttled = self._attempt("delta")
        self.assertEqual(throttled.status_code, 429)
        self.assertIn("detail", throttled.data)

    def test_successful_login_resets_the_per_account_budget(self):
        with self.settings(
            AAMS_LOGIN_THROTTLE_RATE="3/min",
            AAMS_LOGIN_IP_THROTTLE_RATE="200/min",
        ):
            for _ in range(2):
                self.assertEqual(self._attempt().status_code, 401)
            success = self.client.post(
                "/api/auth/login/",
                {"username": "throtuser", "password": "Passw0rd!"},
                format="json",
            )
            self.assertEqual(success.status_code, 200)
            # The per-account budget is reset, so a full budget is available
            # again (allow requests 1..3, throttle the 4th in the window).
            for _ in range(3):
                self.assertEqual(self._attempt().status_code, 401)
            self.assertEqual(self._attempt().status_code, 429)

    def test_missing_username_requests_are_not_counted_against_an_account(self):
        with self.settings(
            AAMS_LOGIN_THROTTLE_RATE="2/min",
            AAMS_LOGIN_IP_THROTTLE_RATE="200/min",
        ):
            for _ in range(4):
                response = self.client.post(
                    "/api/auth/login/", {}, format="json"
                )
                self.assertEqual(response.status_code, 400)


class ErrorSemanticsTests(APITestCase):
    """HTTP error semantics: 401 / 403 / 404 / 400 / 405 keep the envelope."""

    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.admin = User.objects.create_user(
            username="admin_err",
            email="admin@err.local",
            password="Passw0rd!",
            role=Role.ADMIN,
        )
        self.student = User.objects.create_user(
            username="student_err",
            email="student@err.local",
            password="Passw0rd!",
            role=Role.STUDENT,
        )

    def test_missing_resource_returns_real_404(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/teachers/9999999/")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["detail"], "Not found.")

    def test_unauthenticated_protected_endpoint_returns_401(self):
        response = self.client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 401)
        self.assertIn("detail", response.data)

    def test_wrong_role_returns_403(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.get("/api/teachers/")
        self.assertEqual(response.status_code, 403)
        self.assertIn("detail", response.data)

    def test_validation_error_returns_400(self):
        response = self.client.post("/api/auth/login/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("detail", response.data)

    def test_method_not_allowed_returns_405(self):
        response = self.client.put("/api/auth/login/", {}, format="json")
        self.assertEqual(response.status_code, 405)
        self.assertIn("detail", response.data)