from datetime import date, time
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from apps.academics.models import (
    DayOfWeek,
    Holiday,
    Section,
    Semester,
    SemesterStatus,
    Subject,
    SubjectType,
    TeacherAssignment,
    TeachingSession,
    TimetableSlot,
)
from apps.academics.services import (
    assert_teacher_single_module_per_semester,
    check_timetable_conflicts,
    validate_semester_consistency,
)
from apps.accounts.models import Role
from apps.attendance.models import (
    AttendanceRecord,
    AttendanceSession,
    QRAttendanceSession,
)
from apps.students.models import Student
from apps.teachers.models import Teacher

User = get_user_model()


class AcademicsBase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@test.local", password="Passw0rd!", role=Role.ADMIN
        )
        self.teacher = User.objects.create_user(
            email="teacher@test.local", password="Passw0rd!", role=Role.TEACHER
        )
        self.semester = Semester.objects.create(
            code="SEM-T1",
            name="Test Semester",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.sem2 = Semester.objects.create(
            code="SEM-T2",
            name="Test Semester 2",
            academic_year="2025-2026",
            start_date=date(2026, 6, 1),
            end_date=date(2026, 11, 30),
            status=SemesterStatus.UPCOMING,
        )
        self.section_a = Section.objects.create(
            semester=self.semester, name="A", capacity=5
        )
        self.section_b = Section.objects.create(
            semester=self.semester, name="B", capacity=5
        )
        self.subject = Subject.objects.create(
            semester=self.semester, code="T1", name="Subject 1", type=SubjectType.LECTURE
        )
        self.subject2 = Subject.objects.create(
            semester=self.semester, code="T2", name="Subject 2", type=SubjectType.LECTURE
        )
        self.out_of_sem_subject = Subject.objects.create(
            semester=self.sem2, code="O1", name="Outside", type=SubjectType.LECTURE
        )
        self.teacher_profile = Teacher.objects.create(
            teacher_id="tch-test-1",
            name="Dr. Test",
            email=self.teacher.email,
        )
        self.teacher.teacher_profile = self.teacher_profile
        self.teacher.save(update_fields=["teacher_profile"])

    def auth_admin(self):
        self.client.credentials(
            HTTP_AUTHORIZATION="Token " + self._token_for(self.admin)
        )

    def auth_teacher(self):
        self.client.credentials(
            HTTP_AUTHORIZATION="Token " + self._token_for(self.teacher)
        )

    def _token_for(self, user):
        from apps.accounts.models import ExpiringToken

        return ExpiringToken.issue_for(user).key


class SemesterConsistencyTests(AcademicsBase):
    def test_section_subject_must_share_semester(self):
        with self.assertRaises(Exception):
            validate_semester_consistency(
                semester=self.semester,
                section=self.section_a,
                subject=self.out_of_sem_subject,
            )

    def test_matching_semester_is_fine(self):
        validate_semester_consistency(
            semester=self.semester, section=self.section_a, subject=self.subject
        )


class SingleModuleRuleTests(AcademicsBase):
    def test_teacher_cannot_teach_two_subjects_in_same_semester(self):
        # First module is allowed.
        assert_teacher_single_module_per_semester(
            self.teacher_profile, self.subject, self.semester
        )
        TeacherAssignment.objects.create(
            teacher=self.teacher_profile,
            semester=self.semester,
            section=self.section_a,
            subject=self.subject,
        )
        # A different subject in the same semester is rejected.
        with self.assertRaises(Exception):
            assert_teacher_single_module_per_semester(
                self.teacher_profile, self.subject2, self.semester
            )

    def test_same_subject_across_sections_is_allowed(self):
        TeacherAssignment.objects.create(
            teacher=self.teacher_profile,
            semester=self.semester,
            section=self.section_a,
            subject=self.subject,
        )
        # Same subject in another section is the SAME module -> allowed.
        TeacherAssignment.objects.create(
            teacher=self.teacher_profile,
            semester=self.semester,
            section=self.section_b,
            subject=self.subject,
        )


class TimetableConflictTests(AcademicsBase):
    def setUp(self):
        super().setUp()
        self.existing = TimetableSlot.objects.create(
            semester=self.semester,
            section=self.section_a,
            subject=self.subject,
            teacher=self.teacher_profile,
            day=DayOfWeek.MONDAY,
            start_time=time(11, 15),
            end_time=time(12, 15),
            room="T-301",
            class_type=SubjectType.LECTURE,
            is_combined=False,
        )
        self.existing.sections.add(self.section_a)

    def _check(self, **over):
        params = dict(
            semester=self.semester,
            teacher=self.teacher_profile,
            section=self.section_b,
            section_ids=[],
            day=DayOfWeek.MONDAY,
            start_time=time(11, 30),
            end_time=time(12, 30),
            room="T-302",
            class_type=SubjectType.LECTURE,
        )
        params.update(over)
        return check_timetable_conflicts(**params)

    def test_non_overlapping_slot_is_fine(self):
        other = Teacher.objects.create(
            teacher_id="other", name="Other", email="other@test.local"
        )
        conflict = self._check(
            teacher=other,
            start_time=time(13, 30),
            end_time=time(14, 30),
        )
        self.assertIsNone(conflict)

    def test_overlapping_slots_for_same_teacher_conflict(self):
        conflict = self._check(teacher=self.teacher_profile, room="T-302")
        self.assertIsNotNone(conflict)
        self.assertIn("already has a scheduled class", conflict)

    def test_overlapping_same_room_conflict(self):
        other = Teacher.objects.create(
            teacher_id="other", name="Other", email="other@test.local"
        )
        conflict = self._check(teacher=other, room="T-301")
        self.assertIsNotNone(conflict)
        self.assertIn("already booked", conflict)


class AssignmentApiTests(AcademicsBase):
    def setUp(self):
        super().setUp()
        self.auth_admin()

    def test_teacher_cannot_create_subject(self):
        self.auth_teacher()
        response = self.client.post(
            "/api/academics/subjects/",
            {"semester": self.semester.id, "code": "X", "name": "X"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_creates_duplicate_subject_fails(self):
        self.client.post(
            "/api/academics/subjects/",
            {
                "semester": self.semester.id,
                "code": "DUP",
                "name": "Dup",
                "type": SubjectType.LECTURE,
            },
            format="json",
        )
        response = self.client.post(
            "/api/academics/subjects/",
            {
                "semester": self.semester.id,
                "code": "DUP",
                "name": "Dup",
                "type": SubjectType.LECTURE,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_duplicate_assignment_rejected(self):
        payload = {
            "teacher": self.teacher_profile.id,
            "semester": self.semester.id,
            "section": self.section_a.id,
            "subject": self.subject.id,
        }
        first = self.client.post("/api/academics/assignments/", payload, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        second = self.client.post("/api/academics/assignments/", payload, format="json")
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_different_subject_same_semester_rejected(self):
        payload = {
            "teacher": self.teacher_profile.id,
            "semester": self.semester.id,
            "section": self.section_a.id,
            "subject": self.subject.id,
        }
        self.client.post("/api/academics/assignments/", payload, format="json")
        response = self.client.post(
            "/api/academics/assignments/",
            {
                "teacher": self.teacher_profile.id,
                "semester": self.semester.id,
                "section": self.section_a.id,
                "subject": self.subject2.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# Timetable Excel import (Phase 9): preview / confirm / validation
# ---------------------------------------------------------------------------

import io
import uuid as uuid_mod
from unittest.mock import patch

import openpyxl

from apps.academics.models import TimetableImportSession


def _xlsx_bytes(rows, title="Sheet1"):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = title
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


class TimetableImportBase(AcademicsBase):
    HEADERS = [
        "Semester", "Section", "Day", "Module Code", "Module Title",
        "Lecturer", "Start Time", "End Time", "Classroom", "Class Type",
    ]

    def setUp(self):
        super().setUp()
        self.auth_admin()
        self.other_admin = User.objects.create_user(
            email="admin2@test.local", password="Passw0rd!", role=Role.ADMIN
        )

    def auth_user(self, user):
        from apps.accounts.models import ExpiringToken

        self.client.credentials(
            HTTP_AUTHORIZATION="Token " + ExpiringToken.issue_for(user).key
        )

    def _upload(self, rows, name="timetable.xlsx", title="Sheet1", headers=None):
        from django.core.files.uploadedfile import SimpleUploadedFile

        header_row = headers if headers is not None else self.HEADERS
        content = SimpleUploadedFile(name, _xlsx_bytes([header_row] + rows, title))
        return self.client.post(
            "/api/academics/timetable-import/preview/",
            {"file": content},
            format="multipart",
        )

    def _confirm(self, session_uuid):
        return self.client.post(
            "/api/academics/timetable-import/confirm/",
            {"session_uuid": session_uuid},
            format="json",
        )

    def _valid_row(self, **over):
        row = {
            "semester": "SEM-T1",
            "section": "A",
            "day": "Monday",
            "module_code": "T1",
            "module_title": "Subject 1",
            "lecturer": "Dr. Test",
            "start_time": "09:00",
            "end_time": "10:00",
            "classroom": "R-101",
            "class_type": "Lecture",
        }
        row.update(over)
        return [
            row["semester"], row["section"], row["day"], row["module_code"],
            row["module_title"], row["lecturer"], row["start_time"],
            row["end_time"], row["classroom"], row["class_type"],
        ]


class TimetableImportPermissionsTests(TimetableImportBase):
    def test_unauthenticated_preview_rejected(self):
        self.client.credentials()
        response = self.client.post(
            "/api/academics/timetable-import/preview/", {}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_teacher_role_rejected_for_all_actions(self):
        self.auth_teacher()
        upload = self._upload([self._valid_row()])
        self.assertEqual(upload.status_code, status.HTTP_403_FORBIDDEN)
        confirm = self._confirm(str(uuid_mod.uuid4()))
        self.assertEqual(confirm.status_code, status.HTTP_403_FORBIDDEN)
        listing = self.client.get("/api/academics/timetable-import/")
        self.assertEqual(listing.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_preview_valid_file(self):
        response = self._upload([self._valid_row()])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("session_uuid", response.data)
        self.assertEqual(response.data["summary"]["counts"]["new_rows"], 1)

    def test_list_is_scoped_to_the_importing_admin(self):
        self._upload([self._valid_row()])
        self.auth_user(self.other_admin)
        response = self.client.get("/api/academics/timetable-import/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_confirm_only_visible_to_owner(self):
        uuid_value = self._upload([self._valid_row()]).data["session_uuid"]
        self.auth_user(self.other_admin)
        response = self._confirm(uuid_value)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class TimetableImportFileValidationTests(TimetableImportBase):
    def test_missing_file_rejected(self):
        response = self.client.post(
            "/api/academics/timetable-import/preview/", {}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_legacy_xls_rejected(self):
        row = self._valid_row()
        response = self._upload([row], name="timetable.xls")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Legacy .xls", response.data["detail"])

    def test_unknown_extension_rejected(self):
        response = self._upload([self._valid_row()], name="timetable.csv")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Unsupported file type", response.data["detail"])

    def test_corrupt_workbook_rejected(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        content = SimpleUploadedFile("broken.xlsx", b"not really excel")
        response = self.client.post(
            "/api/academics/timetable-import/preview/",
            {"file": content},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not a readable Excel workbook", response.data["detail"])

    def test_oversized_file_rejected(self):
        with patch("apps.academics.timetable_import.MAX_FILE_BYTES", 4):
            response = self._upload([self._valid_row()])
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("maximum allowed", response.data["detail"])

    def test_missing_required_columns_rejected(self):
        headers = [
            "Semester", "Day", "Module Code", "Module Title",
            "Lecturer", "Start Time", "End Time", "Classroom", "Class Type",
        ]
        rows = [["SEM-T1", "Monday", "T1", "Subject 1", "Dr. Test", "09:00", "10:00", "R-101", "Lecture"]]
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
        content = io.BytesIO()
        workbook.save(content)
        content.seek(0)
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self.client.post(
            "/api/academics/timetable-import/preview/",
            {"file": SimpleUploadedFile("missing.xlsx", content.getvalue())},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        detail = response.data["detail"]
        self.assertTrue(
            "Section" in detail or "missing required columns" in detail,
            f"unexpected detail: {detail}",
        )

    def test_workbook_with_no_data_rows_rejected(self):
        response = self._upload([])
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("no timetable rows", response.data["detail"])

    def test_too_many_data_rows_rejected(self):
        from apps.academics.timetable_import import MAX_DATA_ROWS

        rows = [self._valid_row() for _ in range(MAX_DATA_ROWS + 1)]
        response = self._upload(rows)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "file_too_many_rows")


class TimetableImportMatchingTests(TimetableImportBase):
    def _preview_row(self, **over):
        response = self._upload([self._valid_row(**over)])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data["rows"][0], response.data

    def test_unknown_semester_row_error(self):
        row, _ = self._preview_row(semester="NOPE")
        self.assertEqual(row["status"], "error")
        self.assertIn("UNKNOWN_SEMESTER", [i["code"] for i in row["issues"]])
        self.assertEqual(row["plan"], "error")

    def test_unknown_section_row_error(self):
        row, _ = self._preview_row(section="X")
        self.assertEqual(row["status"], "error")
        self.assertIn("UNKNOWN_SECTION", [i["code"] for i in row["issues"]])

    def test_unknown_subject_code_row_error(self):
        row, _ = self._preview_row(module_code="NOPE")
        self.assertEqual(row["status"], "error")
        self.assertIn("UNKNOWN_SUBJECT", [i["code"] for i in row["issues"]])

    def test_unknown_teacher_row_error(self):
        row, _ = self._preview_row(lecturer="Nobody")
        self.assertEqual(row["status"], "error")
        self.assertIn("UNKNOWN_TEACHER", [i["code"] for i in row["issues"]])

    def test_ambiguous_teacher_row_error(self):
        Teacher.objects.create(
            teacher_id="clash", name="Dr. Test", email="clash@test.local"
        )
        row, _ = self._preview_row()
        self.assertEqual(row["status"], "error")
        self.assertIn("AMBIGUOUS_TEACHER", [i["code"] for i in row["issues"]])

    def test_title_mismatch_is_warning_not_error(self):
        row, _ = self._preview_row(module_title="Different Title")
        self.assertEqual(row["status"], "warning")
        self.assertIn("TITLE_MISMATCH", [i["code"] for i in row["issues"]])
        self.assertEqual(row["plan"], "new")

    def test_subject_matched_by_title_only(self):
        row, _ = self._preview_row(module_code="")
        self.assertEqual(row["plan"], "new")
        self.assertEqual(row["status"], "valid")
        self.assertEqual(row["subject"]["name"], "Subject 1")

    def test_ambiguous_subject_by_title_error(self):
        Subject.objects.create(
            semester=self.semester, code="T3", name="Subject 1",
            type=SubjectType.LECTURE,
        )
        row, _ = self._preview_row(module_code="")
        self.assertEqual(row["status"], "error")
        self.assertIn("AMBIGUOUS_SUBJECT", [i["code"] for i in row["issues"]])

    def test_missing_module_and_title_error(self):
        row, _ = self._preview_row(module_code="", module_title="")
        self.assertEqual(row["status"], "error")
        self.assertIn("MISSING_MODULE", [i["code"] for i in row["issues"]])

    def test_unsupported_day_error(self):
        row, _ = self._preview_row(day="Saturday")
        self.assertEqual(row["status"], "error")
        self.assertIn("INVALID_DAY", [i["code"] for i in row["issues"]])

    def test_invalid_class_type_error(self):
        row, _ = self._preview_row(class_type="Seminar")
        self.assertEqual(row["status"], "error")
        self.assertIn("INVALID_CLASS_TYPE", [i["code"] for i in row["issues"]])

    def test_blank_class_type_defaults_to_lecture_warning(self):
        row, _ = self._preview_row(class_type="")
        self.assertEqual(row["plan"], "new")
        self.assertIn("CLASS_TYPE_DEFAULT", [i["code"] for i in row["issues"]])


class TimetableImportCombinedSectionTests(TimetableImportBase):
    def setUp(self):
        super().setUp()
        self.f254 = Section.objects.create(semester=self.semester, name="F254")
        self.f255 = Section.objects.create(semester=self.semester, name="F255")
        self.f256 = Section.objects.create(semester=self.semester, name="F256")

    def test_group_expression_expands_to_one_combined_slot(self):
        response = self._upload([self._valid_row(section="F25 (4+5+6)")])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "new")
        self.assertEqual(row["status"], "valid")
        self.assertTrue(row["is_combined"])
        self.assertEqual(
            [s["name"] for s in row["sections"]], ["F254", "F255", "F256"]
        )

    def test_paren_expression_without_separator_expands(self):
        response = self._upload([self._valid_row(section="F(254+255+256)")])
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "new")
        self.assertEqual([s["name"] for s in row["sections"]], ["F254", "F255", "F256"])

    def test_plus_list_without_group_expands(self):
        f1 = Section.objects.create(semester=self.semester, name="F1")
        f2 = Section.objects.create(semester=self.semester, name="F2")
        response = self._upload([self._valid_row(section="F1+F2")])
        row = response.data["rows"][0]
        self.assertEqual(row["plan"], "new")
        self.assertEqual(
            [s["name"] for s in row["sections"]], [f1.name, f2.name]
        )

    def test_unparseable_group_expression_is_error_not_guess(self):
        response = self._upload([self._valid_row(section="F25 (4+5+6) extra")])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "error")
        self.assertIn(
            "AMBIGUOUS_SECTION", [i["code"] for i in row["issues"]]
        )

    def test_practical_combined_sections_conflict(self):
        response = self._upload([
            self._valid_row(section="A+B", class_type="Practical")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "error")
        self.assertIn("CONFLICT", [i["code"] for i in row["issues"]])

    def test_combined_slot_persists_sections_m2m(self):
        response = self._upload([self._valid_row(section="F25 (4+5+6)")])
        uuid_value = response.data["session_uuid"]
        confirmed = self._confirm(uuid_value)
        self.assertEqual(confirmed.status_code, status.HTTP_200_OK)
        slot = TimetableSlot.objects.get(
            semester=self.semester, section=self.f254,
            day=DayOfWeek.MONDAY, start_time=time(9, 0),
        )
        self.assertTrue(slot.is_combined)
        self.assertEqual(
            set(slot.section_ids), {self.f254.id, self.f255.id, self.f256.id}
        )


class TimetableImportConflictTests(TimetableImportBase):
    def setUp(self):
        super().setUp()
        self.existing = TimetableSlot.objects.create(
            semester=self.semester,
            section=self.section_a,
            subject=self.subject,
            teacher=self.teacher_profile,
            day=DayOfWeek.MONDAY,
            start_time=time(9, 0),
            end_time=time(10, 0),
            room="R-101",
            class_type=SubjectType.LECTURE,
        )
        self.existing.sections.add(self.section_a)

    def test_conflicting_slot_is_flagged_in_preview(self):
        # Same teacher, overlapping time, different section -> NOT the same
        # identity, so the planner must surface the teacher collision.
        response = self._upload([
            self._valid_row(section="B", start_time="09:30", end_time="10:30")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "error")
        self.assertIn("CONFLICT", [i["code"] for i in row["issues"]])

    def test_duplicate_rows_within_file_are_skipped(self):
        # Tuesday avoids the Monday existing slot from setUp.
        response = self._upload([
            self._valid_row(day="Tuesday"), self._valid_row(day="Tuesday")
        ])
        rows = response.data["rows"]
        self.assertEqual(rows[0]["plan"], "new")
        self.assertEqual(rows[1]["plan"], "duplicate")
        self.assertEqual(rows[1]["status"], "duplicate")


class TimetableImportConfirmTests(TimetableImportBase):
    def _upload_and_confirm(self, **over):
        response = self._upload([self._valid_row(**over)])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        uuid_value = response.data["session_uuid"]
        confirmed = self._confirm(uuid_value)
        self.assertEqual(confirmed.status_code, status.HTTP_200_OK)
        return response.data, confirmed.data

    def test_happy_path_persists_one_slot(self):
        _, confirmed = self._upload_and_confirm()
        self.assertEqual(confirmed["summary"]["counts"]["created_rows"], 1)
        slot = TimetableSlot.objects.get(
            semester=self.semester, section=self.section_a,
            subject=self.subject, teacher=self.teacher_profile,
            day=DayOfWeek.MONDAY, start_time=time(9, 0),
        )
        self.assertEqual(slot.end_time, time(10, 0))
        self.assertEqual(slot.room, "R-101")
        self.assertEqual(slot.class_type, SubjectType.LECTURE)

    def test_session_becomes_confirmed(self):
        preview, _ = self._upload_and_confirm()
        session = TimetableImportSession.objects.get(
            uuid=preview["session_uuid"]
        )
        self.assertEqual(session.status, TimetableImportSession.Status.CONFIRMED)
        self.assertIsNotNone(session.confirmed_at)

    def test_confirm_twice_rejected(self):
        preview, _ = self._upload_and_confirm()
        second = self._confirm(preview["session_uuid"])
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_unknown_uuid_returns_404(self):
        response = self._confirm(str(uuid_mod.uuid4()))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_confirm_missing_uuid_returns_400(self):
        response = self.client.post(
            "/api/academics/timetable-import/confirm/", {}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_malformed_uuid_returns_400_invalid(self):
        response = self.client.post(
            "/api/academics/timetable-import/confirm/",
            {"session_uuid": "not-a-uuid"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "session_uuid_invalid")

    def test_reimport_is_idempotent(self):
        self._upload_and_confirm()
        preview = self._upload([self._valid_row()]).data
        self.assertEqual(preview["summary"]["counts"]["new_rows"], 0)
        self.assertEqual(preview["summary"]["counts"]["unchanged_rows"], 1)
        unchanged_uuid = preview["session_uuid"]
        confirmed = self._confirm(unchanged_uuid)
        self.assertEqual(confirmed.status_code, status.HTTP_200_OK)
        self.assertEqual(confirmed.data["summary"]["counts"]["created_rows"], 0)
        self.assertEqual(confirmed.data["summary"]["counts"]["updated_rows"], 0)
        self.assertEqual(
            TimetableSlot.objects.filter(section=self.section_a).count(), 1
        )

    def test_update_plan_changes_existing_slot(self):
        preview, _ = self._upload_and_confirm()
        preview_rows, _ = self._upload_and_confirm(end_time="11:00", classroom="R-200")
        self.assertEqual(preview_rows["summary"]["counts"]["new_rows"], 0)
        self.assertEqual(preview_rows["summary"]["counts"]["updated_rows"], 1)
        slot = TimetableSlot.objects.get(semester=self.semester, section=self.section_a)
        self.assertEqual(slot.end_time, time(11, 0))
        self.assertEqual(slot.room, "R-200")
        self.assertEqual(
            TimetableSlot.objects.filter(section=self.section_a).count(), 1
        )

    def test_update_identity_mismatch_prevents_new_slot(self):
        self._upload_and_confirm()
        preview = self._upload(
            [self._valid_row(end_time="11:00", classroom="R-200")]
        ).data
        self.assertEqual(preview["summary"]["counts"]["updated_rows"], 1)
        self.assertEqual(preview["summary"]["counts"]["new_rows"], 0)

    def test_db_error_rolls_back_the_whole_import(self):
        preview = self._upload([
            self._valid_row(),
            self._valid_row(start_time="10:30", end_time="11:30", classroom="R-200"),
        ])
        self.assertEqual(preview.data["summary"]["counts"]["new_rows"], 2)
        uuid_value = preview.data["session_uuid"]

        def boom(*args, **kwargs):
            raise Exception("simulated DB failure")

        with patch(
            "apps.academics.timetable_import.TimetableSlot.objects.create",
            side_effect=boom,
        ):
            confirmed = self._confirm(uuid_value)
        self.assertEqual(confirmed.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            TimetableSlot.objects.filter(semester=self.semester).count(), 0
        )
        session = TimetableImportSession.objects.get(uuid=uuid_value)
        self.assertEqual(session.status, TimetableImportSession.Status.PENDING)

    def test_end_time_column_wins_over_hours(self):
        custom = [
            "SEM-T1", "A", "Monday", "T1", "Subject 1", "Dr. Test",
            "09:00", "10:30", "R-101", "Lecture", "2",
        ]
        headers = [
            "Semester", "Section", "Day", "Module Code", "Module Title",
            "Lecturer", "Start Time", "End Time", "Classroom", "Class Type", "Hours",
        ]
        response = self._upload([custom], headers=headers)
        data = response.data["rows"][0]
        self.assertEqual(data["end_time"], "10:30:00")

    def test_hours_column_drives_end_time(self):
        custom = [
            "SEM-T1", "A", "Monday", "T1", "Subject 1", "Dr. Test",
            "09:00", "", "R-101", "Lecture", "1.5",
        ]
        headers = [
            "Semester", "Section", "Day", "Module Code", "Module Title",
            "Lecturer", "Start Time", "End Time", "Classroom", "Class Type", "Hours",
        ]
        response = self._upload([custom], headers=headers)
        data = response.data["rows"][0]
        self.assertEqual(data["start_time"], "09:00:00")
        self.assertEqual(data["end_time"], "10:30:00")


class TimetableImportTeacherIdentityTests(TimetableImportBase):
    """Phase E: institutional Teacher.teacher_id is the primary timetable
    identity when the workbook supplies it; deterministic name fallback (and
    ambiguity as a hard error) only when no ID is supplied."""

    ID_HEADERS = [
        "Semester", "Section", "Day", "Module Code", "Module Title",
        "Teacher ID", "Lecturer", "Start Time", "End Time", "Classroom",
        "Class Type",
    ]
    ID_ONLY_HEADERS = [h for h in ID_HEADERS if h != "Lecturer"]

    def setUp(self):
        super().setUp()
        self.tch_a = Teacher.objects.create(
            teacher_id="tch-aaa", name="Alpha Teacher", email="alpha@test.local"
        )
        self.tch_b = Teacher.objects.create(
            teacher_id="tch-bbb", name="Beta Teacher", email="beta@test.local"
        )

    def _id_row(self, **over):
        row = {
            "semester": "SEM-T1", "section": "A", "day": "Monday",
            "module_code": "T1", "module_title": "Subject 1",
            "teacher_id": "tch-test-1", "lecturer": "Dr. Test",
            "start_time": "09:00", "end_time": "10:00",
            "classroom": "R-101", "class_type": "Lecture",
        }
        row.update(over)
        return [
            row["semester"], row["section"], row["day"], row["module_code"],
            row["module_title"], row["teacher_id"], row["lecturer"],
            row["start_time"], row["end_time"], row["classroom"],
            row["class_type"],
        ]

    def _id_only_row(self, **over):
        row = {
            "semester": "SEM-T1", "section": "A", "day": "Monday",
            "module_code": "T1", "module_title": "Subject 1",
            "teacher_id": "tch-aaa", "start_time": "09:00",
            "end_time": "10:00", "classroom": "R-101", "class_type": "Lecture",
        }
        row.update(over)
        return [
            row["semester"], row["section"], row["day"], row["module_code"],
            row["module_title"], row["teacher_id"], row["start_time"],
            row["end_time"], row["classroom"], row["class_type"],
        ]

    def _preview_id(self, rows, headers=None):
        response = self._upload(
            rows, headers=headers if headers is not None else self.ID_HEADERS
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response

    def _issues(self, row):
        return [i["code"] for i in row["issues"]]

    # -- 1. Teacher ID is the authoritative identity -----------------------

    def test_valid_teacher_id_resolves_the_correct_teacher(self):
        response = self._preview_id([self._id_row()])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "valid")
        self.assertEqual(row["plan"], "new")
        self.assertEqual(row["teacher"]["teacher_id"], "tch-test-1")
        self.assertEqual(row["teacher"]["name"], "Dr. Test")
        self.assertEqual(row["teacher"]["match_method"], "id")

    def test_teacher_id_takes_precedence_over_teacher_name(self):
        response = self._preview_id([
            self._id_row(teacher_id="tch-aaa", lecturer="Beta Teacher")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["teacher"]["teacher_id"], "tch-aaa")
        self.assertEqual(row["teacher"]["name"], "Alpha Teacher")
        self.assertIn("TEACHER_NAME_MISMATCH", self._issues(row))
        uuid_value = response.data["session_uuid"]
        confirmed = self._confirm(uuid_value)
        self.assertEqual(confirmed.status_code, status.HTTP_200_OK)
        slot = TimetableSlot.objects.get(semester=self.semester, section=self.section_a)
        self.assertEqual(slot.teacher, self.tch_a)
        self.assertNotEqual(slot.teacher, self.tch_b)

    def test_valid_teacher_id_with_matching_name_succeeds(self):
        response = self._preview_id([
            self._id_row(teacher_id="tch-aaa", lecturer="Alpha Teacher")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "valid")
        self.assertNotIn("TEACHER_NAME_MISMATCH", self._issues(row))
        self.assertEqual(row["teacher"]["match_method"], "id")

    def test_teacher_id_with_conflicting_name_is_flagged_and_id_wins(self):
        response = self._preview_id([
            self._id_row(teacher_id="tch-aaa", lecturer="Beta Teacher")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "warning")  # surfaced, not silent
        self.assertEqual(row["teacher"]["teacher_id"], "tch-aaa")
        self.assertIn("TEACHER_NAME_MISMATCH", self._issues(row))

    def test_unknown_teacher_id_is_a_blocking_error(self):
        response = self._preview_id([self._id_row(teacher_id="T-999")])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "error")
        self.assertEqual(row["plan"], "error")
        self.assertIn("UNKNOWN_TEACHER_ID", self._issues(row))
        self.assertIn("T-999", row["issues"][0]["message"])
        self.assertIsNone(row["teacher"])

    def test_unknown_teacher_id_never_falls_back_to_name(self):
        # The name matches an existing teacher, but the supplied ID wins — a
        # missing ID must never silently re-match by name.
        response = self._preview_id([
            self._id_row(teacher_id="T-999", lecturer="Alpha Teacher")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "error")
        self.assertIn("UNKNOWN_TEACHER_ID", self._issues(row))
        self.assertNotIn("UNKNOWN_TEACHER", self._issues(row))
        self.assertIsNone(row["teacher"])

    def test_missing_teacher_id_uses_deterministic_name_fallback(self):
        response = self._preview_id([
            self._id_row(teacher_id="", lecturer="Alpha Teacher")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "valid")
        self.assertEqual(row["teacher"]["teacher_id"], "tch-aaa")
        self.assertEqual(row["teacher"]["name"], "Alpha Teacher")
        self.assertEqual(row["teacher"]["match_method"], "name")

    def test_name_fallback_single_match_succeeds(self):
        response = self._preview_id([
            self._id_row(teacher_id="", lecturer="Beta Teacher", section="B")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "valid")
        self.assertEqual(row["teacher"]["teacher_id"], "tch-bbb")
        self.assertEqual(row["teacher"]["match_method"], "name")

    def test_name_fallback_zero_matches_blocks(self):
        response = self._preview_id([
            self._id_row(teacher_id="", lecturer="Nobody")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "error")
        self.assertIn("UNKNOWN_TEACHER", self._issues(row))

    def test_name_fallback_multiple_matches_blocks_as_ambiguous(self):
        Teacher.objects.create(
            teacher_id="tch-dup", name="Dr. Test", email="dup@test.local"
        )
        response = self._preview_id([
            self._id_row(teacher_id="", lecturer="Dr. Test")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "error")
        self.assertIn("AMBIGUOUS_TEACHER", self._issues(row))

    def test_blank_teacher_id_is_treated_as_missing(self):
        # The column is present but the cell is whitespace-only -> fallback.
        response = self._preview_id([
            self._id_row(teacher_id="   ", lecturer="Beta Teacher", section="B")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["teacher"]["match_method"], "name")
        self.assertEqual(row["teacher"]["teacher_id"], "tch-bbb")

    def test_teacher_id_with_surrounding_whitespace_normalizes(self):
        response = self._preview_id([
            self._id_row(teacher_id="  tch-test-1  ")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["teacher"]["teacher_id"], "tch-test-1")
        self.assertEqual(row["teacher"]["match_method"], "id")

    def test_numeric_teacher_id_normalizes(self):
        Teacher.objects.create(
            teacher_id="4471", name="Num Teacher", email="num@test.local"
        )
        response = self._preview_id([
            self._id_row(teacher_id=4471, section="B")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["teacher"]["teacher_id"], "4471")
        self.assertEqual(row["teacher"]["match_method"], "id")

    def test_overlong_teacher_id_is_blocked(self):
        response = self._preview_id([
            self._id_row(teacher_id="T" * 31, lecturer="Alpha Teacher")
        ])
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "error")
        self.assertIn("TEACHER_ID_TOO_LONG", self._issues(row))

    def test_teacher_id_only_workbook_still_locates_header(self):
        response = self._preview_id(
            [self._id_only_row()], headers=self.ID_ONLY_HEADERS
        )
        row = response.data["rows"][0]
        self.assertEqual(row["status"], "valid")
        self.assertEqual(row["teacher"]["teacher_id"], "tch-aaa")
        self.assertEqual(row["teacher"]["match_method"], "id")

    # -- 2. Nothing is ever auto-created -------------------------------

    def test_teacher_resolution_never_creates_a_teacher(self):
        before = Teacher.objects.count()
        response = self._preview_id([self._id_row()])
        confirmed = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirmed.status_code, status.HTTP_200_OK)
        self.assertEqual(Teacher.objects.count(), before)
        self.assertFalse(Teacher.objects.filter(teacher_id="T-999").exists())

    def test_teacher_resolution_never_creates_a_user(self):
        before = User.objects.filter(role=Role.TEACHER).count()
        response = self._preview_id([self._id_row()])
        confirmed = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirmed.status_code, status.HTTP_200_OK)
        self.assertEqual(User.objects.filter(role=Role.TEACHER).count(), before)

    def test_blocked_unknown_id_creates_no_teacher_or_user(self):
        teachers_before = Teacher.objects.count()
        users_before = User.objects.filter(role=Role.TEACHER).count()
        response = self._preview_id([self._id_row(teacher_id="T-999")])
        confirmed = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirmed.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Teacher.objects.count(), teachers_before)
        self.assertEqual(User.objects.filter(role=Role.TEACHER).count(), users_before)
        self.assertEqual(TimetableSlot.objects.count(), 0)

    # -- 3. Preview / confirm contract ---------------------------------

    def test_preview_contains_teacher_resolution_information(self):
        response = self._preview_id([
            self._id_row(teacher_id="tch-aaa", lecturer="Alpha Teacher")
        ])
        row = response.data["rows"][0]
        teacher = row["teacher"]
        self.assertEqual(teacher["teacher_id"], "tch-aaa")
        self.assertEqual(teacher["match_method"], "id")
        self.assertEqual(teacher["supplied_id"], "tch-aaa")
        self.assertEqual(teacher["supplied_name"], "Alpha Teacher")
        self.assertEqual(row["teacher_id"], "tch-aaa")
        self.assertEqual(row["lecturer"], "Alpha Teacher")

    def test_confirm_revalidates_teacher_identity_server_side(self):
        response = self._preview_id([
            self._id_row(teacher_id="tch-aaa", lecturer="Alpha Teacher")
        ])
        uuid_value = response.data["session_uuid"]
        self.tch_a.delete()
        confirmed = self._confirm(uuid_value)
        self.assertEqual(confirmed.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("UNKNOWN_TEACHER_ID", confirmed.data["detail"])

    def test_teacher_invalid_between_preview_and_confirm_fails_safely(self):
        response = self._preview_id([
            self._id_row(teacher_id="tch-aaa"),
            self._id_row(teacher_id="tch-bbb", section="B", day="Monday",
                         start_time="12:00", end_time="13:00"),
        ])
        self.assertEqual(response.data["summary"]["counts"]["new_rows"], 2)
        uuid_value = response.data["session_uuid"]
        self.tch_a.delete()
        confirmed = self._confirm(uuid_value)
        self.assertEqual(confirmed.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Import blocked", confirmed.data["detail"])
        session = TimetableImportSession.objects.get(uuid=uuid_value)
        self.assertEqual(session.status, TimetableImportSession.Status.PENDING)
        self.assertEqual(TimetableSlot.objects.count(), 0)

    def test_confirmation_failure_causes_zero_timetable_writes(self):
        response = self._preview_id([
            self._id_row(teacher_id="T-999", section="B"),
        ])
        uuid_value = response.data["session_uuid"]
        confirmed = self._confirm(uuid_value)
        self.assertEqual(confirmed.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(TimetableSlot.objects.count(), 0)
        self.assertEqual(
            TimetableSlot.objects.filter(semester=self.semester).count(), 0
        )

    def test_preview_with_error_rows_cannot_be_confirmed_all_or_nothing(self):
        response = self._preview_id([
            self._id_row(),
            self._id_row(teacher_id="T-999", section="B"),
        ])
        self.assertEqual(response.data["summary"]["counts"]["new_rows"], 1)
        self.assertEqual(response.data["summary"]["counts"]["error_rows"], 1)
        uuid_value = response.data["session_uuid"]
        confirmed = self._confirm(uuid_value)
        self.assertEqual(confirmed.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(TimetableSlot.objects.count(), 0)

    # -- 4. Existing behavior preserved with Teacher IDs -----------------

    def test_reimport_with_teacher_id_is_idempotent(self):
        response = self._preview_id([self._id_row()])
        self._confirm(response.data["session_uuid"])
        response2 = self._preview_id([self._id_row()])
        counts2 = response2.data["summary"]["counts"]
        self.assertEqual(counts2["new_rows"], 0)
        self.assertEqual(counts2["unchanged_rows"], 1)
        confirmed = self._confirm(response2.data["session_uuid"])
        self.assertEqual(confirmed.status_code, status.HTTP_200_OK)
        self.assertEqual(confirmed.data["summary"]["counts"]["created_rows"], 0)
        self.assertEqual(
            TimetableSlot.objects.filter(section=self.section_a).count(), 1
        )

    def test_combined_sections_still_work_with_teacher_id(self):
        f254 = Section.objects.create(semester=self.semester, name="F254")
        f255 = Section.objects.create(semester=self.semester, name="F255")
        f256 = Section.objects.create(semester=self.semester, name="F256")
        response = self._preview_id([
            self._id_row(
                section="F25 (4+5+6)", teacher_id="tch-aaa",
                lecturer="Alpha Teacher", start_time="14:00", end_time="15:00",
            )
        ])
        row = response.data["rows"][0]
        self.assertTrue(row["is_combined"])
        self.assertEqual(row["plan"], "new")
        self.assertEqual(row["teacher"]["match_method"], "id")
        confirmed = self._confirm(response.data["session_uuid"])
        self.assertEqual(confirmed.status_code, status.HTTP_200_OK)
        slot = TimetableSlot.objects.get(
            semester=self.semester, section=f254, start_time="14:00:00"
        )
        self.assertTrue(slot.is_combined)
        self.assertEqual(slot.teacher, self.tch_a)
        self.assertEqual(
            set(slot.section_ids), {f254.id, f255.id, f256.id}
        )

    def test_preview_only_touches_staging_state_and_no_master_data(self):
        # §12 data-safety: a PREVIEW must not mutate any master-data table; only
        # the staging Import Session may be created.
        def snapshot():
            return {
                "students": Student.objects.count(),
                "teachers": Teacher.objects.count(),
                "users": User.objects.count(),
                "semesters": Semester.objects.count(),
                "sections": Section.objects.count(),
                "subjects": Subject.objects.count(),
                "holidays": Holiday.objects.count(),
                "assignments": TeacherAssignment.objects.count(),
                "sessions": TeachingSession.objects.count(),
                "slots": TimetableSlot.objects.count(),
                "attendance_sessions": AttendanceSession.objects.count(),
                "attendance_records": AttendanceRecord.objects.count(),
                "qr_sessions": QRAttendanceSession.objects.count(),
            }

        before = snapshot()
        sessions_before = TimetableImportSession.objects.count()
        response = self._preview_id([self._id_row()])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(snapshot(), before)
        self.assertEqual(
            TimetableImportSession.objects.count(), sessions_before + 1
        )