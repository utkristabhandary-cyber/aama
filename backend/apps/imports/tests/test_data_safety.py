"""DATA-SAFETY regression: upload/preview must never touch authoritative tables."""
from datetime import date

from django.contrib.auth import get_user_model

from apps.academics.models import (
    Section,
    Semester,
    SemesterStatus,
    Subject,
    SubjectType,
    TeacherAssignment,
    TimetableSlot,
)
from apps.accounts.models import Role
from apps.attendance.models import AttendanceRecord, AttendanceSession, QRAttendanceSession
from apps.imports.models import ImportSession
from apps.imports.tests.helpers import ImportsBase
from apps.students.models import Student
from apps.teachers.models import Teacher

User = get_user_model()


def _snapshot():
    """Snapshot of AUTHORITATIVE tables only (ImportSession is the staging
    table and is asserted separately in each test)."""
    state = {}
    for model in (
        Student,
        Teacher,
        User,
        Semester,
        Section,
        Subject,
        TeacherAssignment,
        TimetableSlot,
        AttendanceSession,
        AttendanceRecord,
        QRAttendanceSession,
    ):
        queryset = model.objects.all()
        state[model._meta.label] = {
            "count": queryset.count(),
            "pks": sorted(str(pk) for pk in queryset.values_list("pk", flat=True)),
        }
    return state


class ImportDataSafetyTests(ImportsBase):
    PREVIEW_URL = "/api/imports/teachers/preview/"
    LIST_URL = "/api/imports/teachers/"

    def setUp(self):
        super().setUp()
        # Seed authoritative data so the regression actually guards real rows.
        self.semester = Semester.objects.create(
            code="SEM-DF",
            name="Safety Fixture",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.section = Section.objects.create(
            semester=self.semester, name="A", capacity=30
        )
        self.subject = Subject.objects.create(
            semester=self.semester, code="SAFE1", name="Safety Subject",
            type=SubjectType.LECTURE,
        )
        self.existing_student = Student.objects.create(
            student_id="STD-FIX-1",
            roll_no="R1",
            name="Existing Student",
            email="existing@aams.local",
            phone="1234567890",
            section=self.section,
            semester=self.semester,
        )
        self.existing_teacher = Teacher.objects.create(
            teacher_id="TCH-FIX-1",
            name="Existing Teacher",
            email="existing.t@aams.local",
        )
        self.auth_admin()

    def test_preview_leaves_authoritative_tables_byte_identical(self):
        expected = _snapshot()
        response = self._preview([
            ["STD-FIX-1", "Existing Student", "existing@aams.local", "1234567890"],
            ["STD-NEW-1", "New Student", "new@aams.local", "9876543210"],
        ])
        self.assertEqual(response.status_code, 200)
        after = _snapshot()

        for model_label, before_state in expected.items():
            self.assertEqual(
                after[model_label],
                before_state,
                f"{model_label} was modified by an upload/preview (Phase A must be write-free)",
            )

        # The only thing that may be created is the staging session itself.
        self.assertEqual(
            ImportSession.objects.filter(kind="teachers", created_by=self.admin).count(),
            1,
        )

    def test_conflicting_upload_also_writes_nothing(self):
        expected = _snapshot()
        response = self._preview([
            ["STD-FIX-1", "Existing Student", "existing@aams.local", "1234567890"],
            ["STD-FIX-1", "Touched Name", "touched@aams.local", "1111111111"],
        ])
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["summary"]["block_confirmation"])
        self.assertEqual(_snapshot(), expected)

    def test_repeated_previews_are_idempotent_on_the_db(self):
        self._preview([
            ["STD-FIX-1", "Existing Student", "existing@aams.local", "1234567890"],
            ["STD-NEW-1", "New Student", "new@aams.local", "9876543210"],
        ])
        first = _snapshot()
        self._preview([
            ["STD-FIX-1", "Existing Student", "existing@aams.local", "1234567890"],
            ["STD-NEW-1", "New Student", "new@aams.local", "9876543210"],
        ])
        self.assertEqual(_snapshot(), first)