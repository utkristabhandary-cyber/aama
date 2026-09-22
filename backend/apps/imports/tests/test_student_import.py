"""STUDENT import tests (Phase B): mapping, resolution, planning, confirm."""
from datetime import date

from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework import status

from apps.academics.models import Section, Semester, StudentStatus
from apps.accounts.models import Role
from apps.imports.models import ImportSession
from apps.imports.tests.helpers import ImportsBase, xlsx_file
from apps.students.models import Student

STUDENT_HEADERS = [
    "Student ID", "Name", "Email", "Roll Number", "Phone",
    "DOB (A.D.)", "Program/Sec", "Year/Semester", "Status",
]


class StudentUnitTests(SimpleTestCase):
    """Pure-function tests: semester/section/status/dob resolution."""

    def test_extract_ordinal_forms(self):
        from apps.imports.student_import import _extract_ordinal

        self.assertEqual(_extract_ordinal("4"), 4)
        self.assertEqual(_extract_ordinal("4th"), 4)
        self.assertEqual(_extract_ordinal("SEMESTER 4"), 4)
        self.assertEqual(_extract_ordinal("SEM-4"), 4)
        self.assertIsNone(_extract_ordinal("Alpha"))

    def test_status_aliases(self):
        from apps.imports.student_import import _parse_status

        self.assertEqual(_parse_status("active")[0], StudentStatus.ACTIVE)
        self.assertEqual(_parse_status("Enrolled")[0], StudentStatus.ACTIVE)
        self.assertEqual(_parse_status("graduate")[1]["severity"], "suspicious")  # noqa: E501, type: ignore[index]

    def test_dob_ad_iso_and_dmy(self):
        from apps.imports.student_import import _parse_dob

        value, issue = _parse_dob("2004-05-12")
        self.assertEqual(value, date(2004, 5, 12))
        self.assertIsNone(issue)

        value, issue = _parse_dob("12/05/2004")
        self.assertEqual(value, date(2004, 5, 12))
        self.assertIsNone(issue)

        value, issue = _parse_dob("2004/05/12")
        self.assertEqual(value, date(2004, 5, 12))
        self.assertIsNone(issue)

        value, issue = _parse_dob("not-a-date")
        self.assertIsNone(value)
        self.assertEqual(issue["code"], "dob_malformed")  # noqa: E501, type: ignore[index]


class StudentImportBase(ImportsBase):
    PREVIEW_URL = "/api/imports/students/preview/"
    LIST_URL = "/api/imports/students/"
    CONFIRM_URL = "/api/imports/students/confirm/"

    HEADERS = STUDENT_HEADERS

    def setUp(self):
        super().setUp()
        self.semester = Semester.objects.create(
            code="SEM-S4",
            name="Semester 4",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status="active",
        )
        self.section_a = Section.objects.create(
            semester=self.semester, name="A", capacity=60
        )
        self.section_b = Section.objects.create(
            semester=self.semester, name="B", capacity=60
        )

    def _rows(self, rows):
        return self._preview(rows, headers=self.HEADERS)

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


class StudentPreviewTests(StudentImportBase):
    def test_new_students_planned_as_new_with_placement(self):
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "9111111111",
             "2004-05-12", "CSE-A", "SEM-S4", "active"],
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "new")
        self.assertEqual(row["severity"], "valid")
        self.assertIsNone(row["db_match"])
        self.assertEqual(row["placement"]["section"], "A")
        self.assertEqual(row["placement"]["semester"]["code"], "SEM-S4")
        self.assertFalse(response.data["summary"]["block_confirmation"])

    def test_unmapped_program_token_is_notice_only(self):
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "",
             "CSE-B", "SEM-S4", ""],
        ])
        row = response.data["rows"][0]
        codes = [i["code"] for i in row["issues"]]
        self.assertIn("program_unmapped", codes)
        self.assertEqual(row["severity"], "valid")
        self.assertIn("CSE", response.data["summary"]["placement"]["program_tokens"])

    def test_missing_required_fields_is_blocking(self):
        response = self._rows([
            ["", "", "", "", "9111111111", "", "", "", ""],
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "error")
        self.assertEqual(
            {i["code"] for i in row["issues"]}
            & {"missing_student_id", "missing_name", "missing_email", "missing_roll_no"},
            {"missing_student_id", "missing_name", "missing_email", "missing_roll_no"},
        )
        self.assertTrue(response.data["summary"]["block_confirmation"])

    def test_email_conflict_with_existing_student(self):
        Student.objects.create(
            student_id="S-EXIST", name="Existing", email="alice@aams.local",
            roll_no="700",
        )
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "", "", ""],
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "error")
        self.assertIn("email_conflict", {i["code"] for i in row["issues"]})
        self.assertTrue(response.data["summary"]["block_confirmation"])

    def test_unknown_semester_is_blocking(self):
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "",
             "A", "NOPE", ""],
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "error")
        self.assertIn("semester_unknown", {i["code"] for i in row["issues"]})
        self.assertEqual(response.data["summary"]["placement"]["unresolved"], 1)

    def test_ambiguous_semester_is_blocking(self):
        Semester.objects.create(
            code="SEM-O4", name="Semester 4 Other",
            academic_year="2024-2025",
            start_date=date(2025, 1, 1), end_date=date(2025, 6, 1),
            status="active",
        )
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "", "4", ""],
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "error")
        self.assertIn("semester_ambiguous", {i["code"] for i in row["issues"]})

    def test_known_semester_prefers_unique_full_name(self):
        other = Semester.objects.create(
            code="SEM-O4", name="Semester 4 Other",
            academic_year="2024-2025",
            start_date=date(2025, 1, 1), end_date=date(2025, 6, 1),
            status="completed",
        )
        Section.objects.create(semester=other, name="A", capacity=40)
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "",
             "A", "Semester 4 Other", ""],
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "new")
        self.assertEqual(row["placement"]["semester"]["code"], "SEM-O4")

    def test_blank_placement_is_warning_not_blocking(self):
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "",
             "", "", "active"],
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "new")
        self.assertIn("placement_blank", {i["code"] for i in row["issues"]})
        self.assertFalse(response.data["summary"]["block_confirmation"])

    def test_dob_bs_is_warning_not_blocking(self):
        headers = [
            "Student ID", "Name", "Email", "Roll Number",
            "DOB (B.S.)", "Program/Sec", "Year/Semester",
        ]
        response = self._preview(
            [["S-100", "Alice", "alice@aams.local", "101", "2061-01-15",
              "CSE-A", "SEM-S4"]],
            headers=headers,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "new")
        self.assertIn("dob_bs_unconvertible", {i["code"] for i in row["issues"]})

    def test_section_resolved_from_combined_program_sec_token(self):
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "CSE-B", "SEM-S4", ""],
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "new")
        self.assertEqual(row["placement"]["section"], "B")
        self.assertEqual(row["placement"]["program_token"], "CSE")

    def test_missing_required_columns_400(self):
        response = self._preview(
            [["S-100", "Alice", "a@b.com"]],
            headers=["Student ID", "Name", "Email"],
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "file_missing_required_columns")


class StudentConfirmTests(StudentImportBase):
    def test_confirm_creates_students(self):
        preview, confirm = self._preview_and_confirm([
            ["S-100", "Alice", "alice@aams.local", "101", "9111111111",
             "2004-05-12", "CSE-A", "SEM-S4", "active"],
            ["S-101", "Bob", "bob@aams.local", "102", "", "", "A", "SEM-S4", "active"],
        ])
        self.assertEqual(confirm["result"], {
            "total": 2, "created": 2, "updated": 0, "unchanged": 0,
            "accounts_provisioned": 2,
        })

        alice = Student.objects.get(student_id="S-100")
        self.assertEqual(alice.name, "Alice")
        self.assertEqual(alice.roll_no, "101")
        self.assertEqual(alice.dob, date(2004, 5, 12))
        self.assertEqual(alice.section, self.section_a)
        self.assertEqual(alice.semester, self.semester)
        self.assertEqual(alice.status, StudentStatus.ACTIVE)

        bob = Student.objects.get(student_id="S-101")
        self.assertEqual(bob.section, self.section_a)
        self.assertIsNone(bob.dob)

        session = ImportSession.objects.get(uuid=preview["session_uuid"])
        self.assertEqual(session.status, ImportSession.Status.CONFIRMED)
        self.assertIsNotNone(session.confirmed_at)

    def test_confirm_idempotent_second_run_is_unchanged(self):
        first_preview, first_confirm = self._preview_and_confirm([
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "A", "SEM-S4", ""],
        ])
        self.assertEqual(first_confirm["result"]["created"], 1)

        second_preview, second_confirm = self._preview_and_confirm([
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "A", "SEM-S4", ""],
        ])
        self.assertEqual(second_confirm["result"], {
            "total": 1, "created": 0, "updated": 0, "unchanged": 1,
            "accounts_provisioned": 0,
        })
        self.assertEqual(Student.objects.filter(student_id="S-100").count(), 1)

    def test_confirm_updates_placement_and_fields(self):
        existing = Student.objects.create(
            student_id="S-100", name="Alice", email="alice@aams.local",
            roll_no="101", phone="",
        )
        preview, confirm = self._preview_and_confirm([
            ["S-100", "Alice Updated", "alice@aams.local", "101", "9999",
             "", "CSE-B", "SEM-S4", "graduated"],
        ])
        self.assertEqual(confirm["result"], {
            "total": 1, "created": 0, "updated": 1, "unchanged": 0,
            "accounts_provisioned": 0,
        })
        existing.refresh_from_db()
        self.assertEqual(existing.name, "Alice Updated")
        self.assertEqual(existing.phone, "9999")
        self.assertEqual(existing.section, self.section_b)
        self.assertEqual(existing.status, StudentStatus.GRADUATED)

    def test_blocking_error_refuses_entire_import(self):
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "A", "SEM-S4", ""],
            ["", "NoId", "", "", "", "", "", "", ""],
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        confirm = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(confirm.data["code"], "blocked_student_errors")
        self.assertEqual(Student.objects.count(), 0)

    def test_infile_duplicate_blocks_confirmation(self):
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "A", "SEM-S4", ""],
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "A", "SEM-S4", ""],
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data["rows"][1]
        self.assertEqual(row["plan"], "duplicate")
        confirm = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_scoped_to_owner_and_kind(self):
        preview = self._rows([["S-100", "Alice", "alice@aams.local", "101", "", "", "A", "SEM-S4", ""]])

        self.auth_as(self.other_admin)
        confirm = self._confirm(preview.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_404_NOT_FOUND)

        self.auth_as(self.teacher)
        confirm = self._confirm(preview.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_403_FORBIDDEN)

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

    def test_confirm_already_confirmed_session_rejected(self):
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "A", "SEM-S4", ""],
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        session_uuid = response.data["session_uuid"]

        confirm = self._confirm(session_uuid)
        self.assertEqual(confirm.status_code, status.HTTP_200_OK)

        again = self._confirm(session_uuid)
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(again.data["code"], "already_confirmed")

    def test_confirm_never_writes_on_error(self):
        response = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "", "A", "SEM-S4", ""],
            ["S-101", "Bob", "bob@aams.local", "102", "", "", "Z", "SEM-S4", ""],
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        confirm = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue("section_unknown" in confirm.data["detail"] or "blocked" in confirm.data["detail"])
        self.assertEqual(Student.objects.count(), 0)

    def test_confirm_returns_row_validation_failed_code(self):
        first = self._rows([
            ["S-100", "Alice", "duplicate-student@aams.local", "101", "", "", "A", "SEM-S4", ""],
        ])
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        blocked = self._rows([
            ["S-100", "Alice", "alice@example..com", "101", "", "", "A", "SEM-S4", ""],
        ])
        self.assertEqual(blocked.status_code, status.HTTP_200_OK)
        confirm = self._confirm(blocked.data["session_uuid"])
        self.assertEqual(confirm.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(confirm.data["code"], "row_validation_failed")
        self.assertEqual(Student.objects.count(), 0)


class StudentHistoryTests(StudentImportBase):
    def test_history_lists_own_sessions_newest_first(self):
        self._rows([["S-100", "Alice", "alice@aams.local", "101", "", "", "A", "SEM-S4", ""]])
        self._rows([["S-101", "Bob", "bob@aams.local", "102", "", "", "A", "SEM-S4", ""]])
        response = self.client.get(self.LIST_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]["file_name"], "students.xlsx")
        self.assertEqual(response.data[0]["kind"], "students")

    def test_history_includes_student_summary_blocks(self):
        preview = self._rows([
            ["S-100", "Alice", "alice@aams.local", "101", "", "",
             "CSE-A", "SEM-S4", "active"],
        ])
        session = ImportSession.objects.get(uuid=preview.data["session_uuid"])
        self.assertIn("plans", session.summary)
        self.assertIn("placement", session.summary)
        self.assertEqual(session.summary["placement"]["program_tokens"], ["CSE"])