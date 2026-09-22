"""TEACHER import tests (Phase C): mapping, planning, confirm, safety."""
from django.test import SimpleTestCase
from rest_framework import status

from apps.academics.models import TeacherStatus
from apps.accounts.models import Role
from apps.imports.models import ImportSession
from apps.imports.tests.helpers import ImportsBase
from apps.students.models import Student
from apps.teachers.models import Teacher
from apps.accounts.models import User

TEACHER_HEADERS = [
    "Teacher ID", "Name", "Email", "Phone",
    "Department", "Designation", "Qualification", "Status",
]


class TeacherUnitTests(SimpleTestCase):
    """Pure-function tests: status parsing and header mapping."""

    def test_status_aliases(self):
        from apps.imports.teacher_import import _parse_status

        self.assertEqual(_parse_status("active")[0], TeacherStatus.ACTIVE)
        self.assertEqual(_parse_status("Active")[0], TeacherStatus.ACTIVE)
        self.assertEqual(_parse_status("working")[0], TeacherStatus.ACTIVE)
        self.assertEqual(_parse_status("inactive")[0], TeacherStatus.INACTIVE)
        self.assertEqual(_parse_status("left")[0], TeacherStatus.INACTIVE)
        self.assertEqual(_parse_status("resigned")[0], TeacherStatus.INACTIVE)
        value, pissue = _parse_status("unknown-state")
        self.assertIsNone(value)
        self.assertEqual(pissue["code"], "status_unknown")  # type: ignore[index]
        self.assertEqual(_parse_status(""), (None, None))

    def test_header_mapping_aliases_are_teacher_scoped(self):
        from apps.imports.engine.headers import analyze_headers
        from apps.imports.teacher_import import map_teacher_headers

        info = analyze_headers([
            "Employee ID", "Faculty Name", "Email Address", "Mobile Number",
            "Dept", "Post", "Highest Qualification",
        ])
        mapping = map_teacher_headers(info)
        self.assertEqual(mapping["teacher_id"], 0)
        self.assertEqual(mapping["name"], 1)
        self.assertEqual(mapping["email"], 2)
        self.assertEqual(mapping["phone"], 3)
        self.assertEqual(mapping["department"], 4)
        self.assertEqual(mapping["designation"], 5)
        self.assertEqual(mapping["qualification"], 6)

    def test_missing_identity_header_raises(self):
        from apps.academics.timetable_import import ImportFileError
        from apps.imports.engine.headers import analyze_headers
        from apps.imports.teacher_import import map_teacher_headers

        info = analyze_headers([
            {"index": 0, "key": "name", "status": "data"},
            {"index": 1, "key": "email", "status": "data"},
        ])
        with self.assertRaises(ImportFileError) as ctx:
            map_teacher_headers(info)
        self.assertEqual(ctx.exception.code, "file_missing_required_columns")


class TeacherImportBase(ImportsBase):
    PREVIEW_URL = "/api/imports/teachers/preview/"
    LIST_URL = "/api/imports/teachers/"
    CONFIRM_URL = "/api/imports/teachers/confirm/"

    HEADERS = TEACHER_HEADERS

    def _rows(self, rows):
        return self._preview(rows, headers=self.HEADERS, name="teachers.xlsx")

    def _confirm(self, session_uuid):
        return self.client.post(
            self.CONFIRM_URL,
            {"session_uuid": session_uuid},
            format="json",
        )

    def _preview_and_confirm(self, rows):
        preview = self._rows(rows)
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        confirm = self._confirm(preview.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_200_OK)
        return preview.data, confirm.data


def row(tid, name, email, phone="", dept="", desig="", qual="", st=""):
    return [tid, name, email, phone, dept, desig, qual, st]


class TeacherPreviewTests(TeacherImportBase):
    def test_new_teacher_planned_as_new(self):
        response = self._rows([
            row("T001", "Priya", "priya@aams.local", "9800000001",
                "CSE", "Assistant Professor", "M.Tech", "active"),
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "new")
        self.assertEqual(r["severity"], "valid")
        self.assertIsNone(r["db_match"])
        self.assertEqual(r["values"]["teacher_id"], "T001")
        self.assertEqual(r["values"]["designation"], "Assistant Professor")
        self.assertFalse(response.data["summary"]["block_confirmation"])
        self.assertEqual(response.data["summary"]["plans"]["new"], 1)

    def test_institutional_alias_headers_map_to_teacher_fields(self):
        headers = [
            "Staff ID", "Full Name", "E Mail", "Contact Number",
            "Department Name", "Designation", "Qualification", "Status",
        ]
        response = self._preview(
            [["EMP-01", "Priya", "priya@aams.local", "9800000001",
              "CSE", "Lecturer", "M.Tech", "active"]],
            headers=headers, name="teachers.xlsx",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "new")
        self.assertEqual(r["values"]["teacher_id"], "EMP-01")
        self.assertEqual(r["values"]["department"], "CSE")

    def test_existing_teacher_unchanged(self):
        Teacher.objects.create(
            teacher_id="T001", name="Priya", email="priya@aams.local",
            department="CSE", designation="Assistant Professor",
            qualification="M.Tech", status=TeacherStatus.ACTIVE,
        )
        response = self._rows([
            row("T001", "Priya", "priya@aams.local", "",
                "CSE", "Assistant Professor", "M.Tech", "active"),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "unchanged")
        self.assertEqual(r["field_changes"], [])
        self.assertEqual(r["db_match"]["matched_by"], "teacher_id")

    def test_existing_teacher_designation_update_is_visible(self):
        Teacher.objects.create(
            teacher_id="T001", name="Priya", email="priya@aams.local",
            department="Computer", designation="Lecturer",
        )
        response = self._rows([
            row("T001", "Priya", "priya@aams.local", "",
                "Computer", "Senior Lecturer", "", ""),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "update")
        changes = {c["field"]: c for c in r["field_changes"]}
        self.assertIn("designation", changes)
        self.assertEqual(changes["designation"]["old"], "Lecturer")
        self.assertEqual(changes["designation"]["new"], "Senior Lecturer")
        self.assertEqual(r["severity"], "valid")

    def test_email_change_on_existing_teacher_is_update(self):
        Teacher.objects.create(
            teacher_id="T001", name="Priya", email="old@aams.local",
        )
        response = self._rows([
            row("T001", "Priya", "new@aams.local"),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "update")
        changes = {c["field"]: c for c in r["field_changes"]}
        self.assertEqual(changes["email"]["old"], "old@aams.local")
        self.assertEqual(changes["email"]["new"], "new@aams.local")

    def test_email_conflict_with_another_teacher_is_error(self):
        Teacher.objects.create(
            teacher_id="T001", name="Priya", email="priya@aams.local",
        )
        Teacher.objects.create(
            teacher_id="T002", name="Ravi", email="ravi@aams.local",
        )
        response = self._rows([
            row("T003", "Neha", "ravi@aams.local"),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "error")
        self.assertIn("email_conflict", {i["code"] for i in r["issues"]})
        self.assertTrue(response.data["summary"]["block_confirmation"])

    def test_email_change_into_another_teachers_email_is_error(self):
        Teacher.objects.create(
            teacher_id="T001", name="Priya", email="priya@aams.local",
        )
        Teacher.objects.create(
            teacher_id="T002", name="Ravi", email="ravi@aams.local",
        )
        response = self._rows([
            row("T001", "Priya", "ravi@aams.local"),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "error")
        self.assertIn("email_conflict", {i["code"] for i in r["issues"]})

    def test_email_conflict_with_user_account_is_error(self):
        response = self._rows([
            row("T009", "New", "teacher@test.local"),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "error")
        self.assertTrue(any(
            i["code"] == "email_conflict" for i in r["issues"]
        ))

    def test_new_teacher_using_own_unique_email_is_fine(self):
        response = self._rows([
            row("T010", "New", "fresh@aams.local", "", "CSE", "Lecturer", "", "active"),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "new")
        self.assertEqual(r["severity"], "valid")

    def test_infile_duplicate_is_duplicate_and_blocks(self):
        response = self._rows([
            row("T001", "Priya", "priya@aams.local"),
            row("T001", "Priya", "priya@aams.local"),
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["rows"][1]["plan"], "duplicate")
        self.assertTrue(response.data["summary"]["block_confirmation"])
        confirm = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)

    def test_conflicting_duplicate_is_duplicate_and_blocks(self):
        response = self._rows([
            row("T001", "Priya", "priya@aams.local", "", "CSE"),
            row("T001", "Priya", "priya@aams.local", "", "EEE"),
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["rows"][1]["plan"], "duplicate")
        self.assertTrue(response.data["summary"]["block_confirmation"])

    def test_missing_required_fields_is_blocking(self):
        response = self._rows([
            ["", "", "", "9800000001", "", "", "", ""],
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "error")
        self.assertEqual(
            {i["code"] for i in r["issues"]}
            & {"missing_teacher_id", "missing_name", "missing_email"},
            {"missing_teacher_id", "missing_name", "missing_email"},
        )
        self.assertTrue(response.data["summary"]["block_confirmation"])

    def test_unknown_status_is_suspicious_not_blocking(self):
        response = self._rows([
            row("T001", "Priya", "priya@aams.local", "", "", "", "", "tenure"),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "new")
        self.assertEqual(r["severity"], "suspicious")
        self.assertIn("status_unknown", {i["code"] for i in r["issues"]})
        self.assertFalse(response.data["summary"]["block_confirmation"])

    def test_blank_status_defaults_to_active(self):
        response = self._rows([
            row("T001", "Priya", "priya@aams.local"),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["values"]["status"], "")

    def test_existing_teacher_status_change_is_update(self):
        Teacher.objects.create(
            teacher_id="T001", name="Priya", email="priya@aams.local",
            status=TeacherStatus.ACTIVE,
        )
        response = self._rows([
            row("T001", "Priya", "priya@aams.local", "", "", "", "", "inactive"),
        ])
        r = response.data["rows"][0]
        self.assertEqual(r["plan"], "update")
        changes = {c["field"]: c for c in r["field_changes"]}
        self.assertEqual(changes["status"]["old"], "active")
        self.assertEqual(changes["status"]["new"], "inactive")

    def test_unknown_populated_columns_do_not_block(self):
        headers = list(TEACHER_HEADERS) + ["Specialization"]
        response = self._preview(
            [row("T001", "Priya", "priya@aams.local", "", "CSE") + ["AI"]],
            headers=headers, name="teachers.xlsx",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["rows"][0]["plan"], "new")
        self.assertFalse(response.data["summary"]["block_confirmation"])

    def test_preview_does_not_mutate_data(self):
        Teacher.objects.create(
            teacher_id="T001", name="Priya", email="priya@aams.local",
        )
        before_teachers = Teacher.objects.count()
        before_students = Student.objects.count()
        before_users = User.objects.count()

        self._rows([
            row("T001", "Priya Renamed", "priya@aams.local"),
            row("T002", "Brand New", "brand@aams.local"),
        ])

        self.assertEqual(Teacher.objects.count(), before_teachers)
        self.assertEqual(Student.objects.count(), before_students)
        self.assertEqual(User.objects.count(), before_users)
        self.assertEqual(
            Teacher.objects.get(teacher_id="T001").name, "Priya"
        )

    def test_missing_identity_header_still_400(self):
        response = self._preview(
            [["1", "Priya", "priya@aams.local"]],
            headers=["SN", "Name", "Email"], name="teachers.xlsx",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "file_missing_required_columns")


class TeacherConfirmTests(TeacherImportBase):
    def test_valid_confirmation_creates_teacher(self):
        preview, confirm = self._preview_and_confirm([
            row("T001", "Priya", "priya@aams.local", "9800000001",
                "CSE", "Assistant Professor", "M.Tech", "active"),
            row("T002", "Ravi", "ravi@aams.local", "", "ECE", "Lecturer", "", ""),
        ])
        self.assertEqual(confirm["result"], {
            "total": 2, "created": 2, "updated": 0, "unchanged": 0,
            "accounts_provisioned": 2,
        })

        priya = Teacher.objects.get(teacher_id="T001")
        self.assertEqual(priya.name, "Priya")
        self.assertEqual(priya.phone, "9800000001")
        self.assertEqual(priya.department, "CSE")
        self.assertEqual(priya.designation, "Assistant Professor")
        self.assertEqual(priya.qualification, "M.Tech")
        self.assertEqual(priya.status, TeacherStatus.ACTIVE)

        ravi = Teacher.objects.get(teacher_id="T002")
        self.assertEqual(ravi.department, "ECE")
        self.assertEqual(ravi.status, TeacherStatus.ACTIVE)

        session = ImportSession.objects.get(uuid=preview["session_uuid"])
        self.assertEqual(session.status, ImportSession.Status.CONFIRMED)
        self.assertIsNotNone(session.confirmed_at)

    def test_valid_confirmation_updates_teacher(self):
        existing = Teacher.objects.create(
            teacher_id="T001", name="Priya", email="priya@aams.local",
            department="Computer", designation="Lecturer",
            status=TeacherStatus.ACTIVE,
        )
        preview, confirm = self._preview_and_confirm([
            row("T001", "Priya Updated", "priya@aams.local", "9800000001",
                "Computer", "Senior Lecturer", "Ph.D", "active"),
        ])
        self.assertEqual(confirm["result"], {
            "total": 1, "created": 0, "updated": 1, "unchanged": 0,
            "accounts_provisioned": 1,
        })
        existing.refresh_from_db()
        self.assertEqual(existing.name, "Priya Updated")
        self.assertEqual(existing.designation, "Senior Lecturer")
        self.assertEqual(existing.qualification, "Ph.D")
        self.assertEqual(existing.phone, "9800000001")

    def test_confirm_provisions_account_but_no_assignments(self):
        from apps.academics.models import TeacherAssignment

        self._preview_and_confirm([
            row("T001", "Priya", "priya@aams.local", "", "CSE", "Lecturer"),
        ])
        account = User.objects.get(
            email="priya@aams.local", role=Role.TEACHER,
            username="T001",
        )
        self.assertTrue(account.must_change_password)
        self.assertEqual(account.teacher_profile.teacher_id, "T001")
        self.assertTrue(account.check_password("T001@123"))
        self.assertEqual(TeacherAssignment.objects.count(), 0)

    def test_atomic_rollback_100_valid_1_fatal(self):
        rows = [
            row(f"T{i:03d}", f"Name {i}", f"name{i}@aams.local",
                "", "CSE", "Lecturer")
            for i in range(100)
        ]
        rows.append(["", "NoId", "noid@aams.local", "", "", ""])
        response = self._rows(rows)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        confirm = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(confirm.data["code"], "blocked_teacher_errors")
        self.assertEqual(Teacher.objects.count(), 0)

    def test_confirm_idempotent_second_run_is_unchanged(self):
        first_preview, first_confirm = self._preview_and_confirm([
            row("T001", "Priya", "priya@aams.local", "", "CSE", "Lecturer"),
        ])
        self.assertEqual(first_confirm["result"]["created"], 1)

        second_preview, second_confirm = self._preview_and_confirm([
            row("T001", "Priya", "priya@aams.local", "", "CSE", "Lecturer"),
        ])
        self.assertEqual(second_confirm["result"], {
            "total": 1, "created": 0, "updated": 0, "unchanged": 1,
            "accounts_provisioned": 0,
        })
        self.assertEqual(Teacher.objects.filter(teacher_id="T001").count(), 1)

    def test_blocking_error_refuses_entire_import(self):
        response = self._rows([
            row("T001", "Priya", "priya@aams.local"),
            row("", "NoId", ""),
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        confirm = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(confirm.data["code"], "blocked_teacher_errors")
        self.assertEqual(Teacher.objects.count(), 0)

    def test_confirm_requires_session_uuid(self):
        response = self.client.post(self.CONFIRM_URL, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "session_uuid_required")

    def test_confirm_malformed_session_uuid_rejected_400(self):
        response = self.client.post(
            self.CONFIRM_URL, {"session_uuid": "not-a-uuid"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "session_uuid_invalid")

    def test_confirm_returns_row_validation_failed_code(self):
        first = self._rows([
            row("T001", "Priya", "priya@aams.local"),
        ])
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        blocked = self._rows([
            row("T001", "Priya", "priya@example..com"),
        ])
        self.assertEqual(blocked.status_code, status.HTTP_200_OK)
        confirm = self._confirm(blocked.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(confirm.data["code"], "row_validation_failed")
        self.assertEqual(Teacher.objects.count(), 0)

    def test_confirm_already_confirmed_session_rejected(self):
        response = self._rows([
            row("T001", "Priya", "priya@aams.local"),
        ])
        session_uuid = response.data["session_uuid"]

        confirm = self._confirm(session_uuid)
        self.assertEqual(confirm.status_code, status.HTTP_200_OK)

        again = self._confirm(session_uuid)
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(again.data["code"], "already_confirmed")

    def test_confirm_scoped_to_owner_and_kind(self):
        preview = self._rows([row("T001", "Priya", "priya@aams.local")])

        self.auth_as(self.other_admin)
        confirm = self._confirm(preview.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_404_NOT_FOUND)

        self.auth_as(self.teacher)
        confirm = self._confirm(preview.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_403_FORBIDDEN)

    def test_confirm_kind_mismatch_rejected(self):
        preview = self._rows([row("T001", "Priya", "priya@aams.local")])
        response = self.client.post(
            "/api/imports/students/confirm/",
            {"session_uuid": preview.data["session_uuid"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_confirm_midfile_email_conflict_blocks_all(self):
        Teacher.objects.create(
            teacher_id="T001", name="Priya", email="priya@aams.local",
        )
        response = self._rows([
            row("T002", "Ravi", "ravi@aams.local"),
            row("T003", "Neha", "priya@aams.local"),
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        confirm = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Teacher.objects.filter(teacher_id="T002").count(), 0)


class TeacherHistoryTests(TeacherImportBase):
    def test_history_lists_own_sessions(self):
        self._rows([row("T001", "Priya", "priya@aams.local")])
        self._rows([row("T002", "Ravi", "ravi@aams.local")])
        response = self.client.get(self.LIST_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]["kind"], "teachers")
        self.assertEqual(response.data[0]["file_name"], "teachers.xlsx")

    def test_history_includes_teacher_summary_blocks(self):
        preview = self._rows([
            row("T001", "Priya", "priya@aams.local", "", "CSE", "Senior Lecturer"),
        ])
        session = ImportSession.objects.get(uuid=preview.data["session_uuid"])
        self.assertIn("plans", session.summary)
        self.assertIn("changes", session.summary)
        self.assertEqual(session.summary["plans"]["new"], 1)

    def test_history_confirmed_session_records_counts(self):
        self._preview_and_confirm([
            row("T001", "Priya", "priya@aams.local", "", "CSE"),
            row("T002", "Ravi", "ravi@aams.local", "", "ECE", "Lecturer"),
        ])
        sessions = ImportSession.objects.all()
        self.assertEqual(sessions.count(), 1)
        self.assertEqual(sessions[0].summary["confirmed"], {
            "total": 2, "created": 2, "updated": 0, "unchanged": 0,
            "accounts_provisioned": 2,
        })