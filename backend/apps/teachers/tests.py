from datetime import date, time

from django.contrib.auth import get_user_model

from rest_framework.test import APITestCase

from apps.academics.models import (
    AssignmentStatus,
    DayOfWeek,
    Semester,
    SemesterStatus,
    Section,
    Subject,
    SubjectType,
    TeacherAssignment,
    TimetableSlot,
)
from apps.accounts.models import Role
from apps.attendance.models import (
    AttendancePhase,
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
)
from apps.students.models import Student
from apps.teachers.models import Teacher

User = get_user_model()


class TeacherOperationalBase(APITestCase):
    def setUp(self):
        self.semester = Semester.objects.create(
            code="SEM-OP",
            name="Operational",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.section_a = Section.objects.create(
            semester=self.semester, name="A", capacity=5
        )
        self.section_b = Section.objects.create(
            semester=self.semester, name="B", capacity=5
        )
        self.subject = Subject.objects.create(
            semester=self.semester,
            code="OP1",
            name="Operational Subject",
            type=SubjectType.LECTURE,
        )
        self.subject_b = Subject.objects.create(
            semester=self.semester,
            code="OP2",
            name="Operational Subject B",
            type=SubjectType.LECTURE,
        )

        self.teacher_user = User.objects.create_user(
            username="tch-op",
            email="teacher@op.local",
            password="Passw0rd!",
            role=Role.TEACHER,
        )
        self.teacher = Teacher.objects.create(
            teacher_id="tch-op", name="Dr. Operational", email=self.teacher_user.email
        )
        self.teacher_user.teacher_profile = self.teacher
        self.teacher_user.save(update_fields=["teacher_profile"])

        self.student_a = Student.objects.create(
            student_id="std-a",
            roll_no="01",
            name="Alpha",
            email="alpha@op.local",
            section=self.section_a,
            semester=self.semester,
        )
        self.student_b = Student.objects.create(
            student_id="std-b",
            roll_no="02",
            name="Beta",
            email="beta@op.local",
            section=self.section_a,
            semester=self.semester,
        )
        self.student_out = Student.objects.create(
            student_id="std-out",
            roll_no="03",
            name="Outside",
            email="out@op.local",
            section=self.section_b,
            semester=self.semester,
        )

        self.admin_user = User.objects.create_user(
            username="admin-op",
            email="admin@op.local",
            password="Passw0rd!",
            role=Role.ADMIN,
        )
        self.student_user = User.objects.create_user(
            username="std-op",
            email="studenta@op.local",
            password="Passw0rd!",
            role=Role.STUDENT,
        )
        self.student_user.student_profile = self.student_a
        self.student_user.save(update_fields=["student_profile"])

    def _assignment(self, section, subject=None, status=AssignmentStatus.ACTIVE):
        return TeacherAssignment.objects.create(
            teacher=self.teacher,
            semester=self.semester,
            section=section,
            subject=subject or self.subject,
            status=status,
        )

    def _session(self, section, subject=None, session_date=date(2026, 9, 7)):
        session = AttendanceSession.objects.create(
            session_date=session_date,
            subject=subject or self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session.sections.add(section)
        return session

    def _record(self, session, student, status, marking_complete=True):
        return AttendanceRecord.objects.create(
            attendance_session=session,
            student=student,
            status=status,
            marking_complete=marking_complete,
        )


class TeacherStudentsTests(TeacherOperationalBase):
    def setUp(self):
        super().setUp()
        self._assignment(section=self.section_a)

    def test_teacher_gets_own_assigned_roster_with_summary(self):
        session = self._session(self.section_a)
        self._record(session, self.student_a, AttendanceStatus.PRESENT.value)
        self._record(session, self.student_b, AttendanceStatus.ABSENT.value)

        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/teachers/students/")
        self.assertEqual(response.status_code, 200)
        rows = {row["student_id"]: row for row in response.data}

        self.assertIn("std-a", rows)
        self.assertEqual(rows["std-a"]["attendance_summary"]["marked"], 1)
        self.assertEqual(rows["std-a"]["attendance_summary"]["present"], 1)
        self.assertEqual(rows["std-a"]["attendance_summary"]["absent"], 0)
        self.assertEqual(rows["std-a"]["attendance_summary"]["percentage"], 100.0)

        self.assertIn("std-b", rows)
        self.assertEqual(rows["std-b"]["attendance_summary"]["absent"], 1)
        self.assertEqual(rows["std-b"]["attendance_summary"]["percentage"], 0.0)

    def test_late_counts_as_present_for_percentage(self):
        session = self._session(self.section_a)
        self._record(session, self.student_a, AttendanceStatus.LATE.value)

        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/teachers/students/")
        row = response.data[0]
        self.assertEqual(row["attendance_summary"]["present"], 1)
        self.assertEqual(row["attendance_summary"]["late"], 1)
        self.assertEqual(row["attendance_summary"]["percentage"], 100.0)

    def test_unmarked_records_are_excluded(self):
        session = self._session(self.section_a)
        self._record(session, self.student_a, AttendanceStatus.PRESENT.value)
        self._record(
            session, self.student_b, AttendanceStatus.PRESENT.value, marking_complete=False
        )

        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/teachers/students/")
        row = {r["student_id"]: r for r in response.data}["std-b"]
        self.assertEqual(row["attendance_summary"]["marked"], 0)
        self.assertEqual(row["attendance_summary"]["percentage"], 0.0)

    def test_students_outside_assigned_sections_are_excluded(self):
        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/teachers/students/")
        ids = [row["student_id"] for row in response.data]
        self.assertNotIn("std-out", ids)
        self.assertEqual(len(ids), 2)

    def test_admin_cannot_read_teacher_roster(self):
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/teachers/students/")
        self.assertEqual(response.status_code, 403)

    def test_student_cannot_read_teacher_roster(self):
        self.client.force_authenticate(user=self.student_user)
        response = self.client.get("/api/teachers/students/")
        self.assertEqual(response.status_code, 403)

    def test_unassigned_teacher_gets_empty_roster(self):
        other_user = User.objects.create_user(
            username="tch-empty",
            email="empty@op.local",
            password="Passw0rd!",
            role=Role.TEACHER,
        )
        other = Teacher.objects.create(
            teacher_id="tch-empty", name="Empty", email=other_user.email
        )
        other_user.teacher_profile = other
        other_user.save(update_fields=["teacher_profile"])
        self.client.force_authenticate(user=other_user)
        response = self.client.get("/api/teachers/students/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_user_without_teacher_profile_gets_404(self):
        profileless = User.objects.create_user(
            username="tch-none",
            email="none@op.local",
            password="Passw0rd!",
            role=Role.TEACHER,
        )
        self.client.force_authenticate(user=profileless)
        response = self.client.get("/api/teachers/students/")
        self.assertEqual(response.status_code, 404)


class TeacherReportsTests(TeacherOperationalBase):
    def setUp(self):
        super().setUp()
        self._assignment(section=self.section_a)

    def test_one_report_per_active_assignment(self):
        self._session(self.section_a)
        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/teachers/reports/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        report = response.data[0]
        self.assertEqual(report["subject"]["code"], self.subject.code)
        self.assertEqual(report["sections"][0]["name"], "A")
        self.assertEqual(report["sessionCount"], 1)

    def test_metrics_available_and_status_boundary(self):
        sessions = [self._session(self.section_a, session_date=date(2026, 9, i + 1)) for i in range(4)]
        for session in sessions:
            self._record(session, self.student_a, AttendanceStatus.PRESENT.value)
        for session in sessions[:3]:
            self._record(session, self.student_b, AttendanceStatus.ABSENT.value)
        self._record(
            sessions[3], self.student_b, AttendanceStatus.PRESENT.value, marking_complete=False
        )

        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/teachers/reports/")
        metrics = {m["studentCode"]: m for m in response.data[0]["studentMetrics"]}

        self.assertEqual(metrics["std-a"]["attendedSessions"], 4)
        self.assertEqual(metrics["std-a"]["totalSessions"], 4)
        self.assertEqual(metrics["std-a"]["percentage"], 100.0)
        self.assertEqual(metrics["std-a"]["status"], "Clear")

        self.assertEqual(metrics["std-b"]["attendedSessions"], 0)
        self.assertEqual(metrics["std-b"]["totalSessions"], 4)
        self.assertEqual(metrics["std-b"]["percentage"], 0.0)
        self.assertEqual(metrics["std-b"]["status"], "Shortage")
        self.assertEqual(response.data[0]["averagePercentage"], 50.0)

    def test_sessions_covering_other_subject_or_section_are_not_counted(self):
        self._session(self.section_a)
        self._session(self.section_a, subject=self.subject_b)
        other_section_session = self._session(self.section_b)
        self._record(
            other_section_session, self.student_a, AttendanceStatus.PRESENT.value
        )

        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/teachers/reports/")
        self.assertEqual(len(response.data), 1)
        report = response.data[0]
        self.assertEqual(report["sessionCount"], 1)
        self.assertEqual(report["studentMetrics"][0]["totalSessions"], 1)

    def test_inactive_assignments_excluded(self):
        self._assignment(section=self.section_a, subject=self.subject_b, status=AssignmentStatus.INACTIVE)
        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/teachers/reports/")
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["subject"]["code"], self.subject.code)

    def test_reports_empty_for_unassigned_teacher(self):
        other_user = User.objects.create_user(
            username="tch-norep",
            email="norep@op.local",
            password="Passw0rd!",
            role=Role.TEACHER,
        )
        other = Teacher.objects.create(
            teacher_id="tch-norep", name="No Reports", email=other_user.email
        )
        other_user.teacher_profile = other
        other_user.save(update_fields=["teacher_profile"])
        self.client.force_authenticate(user=other_user)
        response = self.client.get("/api/teachers/reports/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_reports_denied_for_non_teacher(self):
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get("/api/teachers/reports/")
        self.assertEqual(response.status_code, 403)

        self.client.force_authenticate(user=self.student_user)
        response = self.client.get("/api/teachers/reports/")
        self.assertEqual(response.status_code, 403)


class TimetableSlotNameFieldsTests(APITestCase):
    def setUp(self):
        self.semester = Semester.objects.create(
            code="SEM-TT",
            name="Timetable",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.section_a = Section.objects.create(
            semester=self.semester, name="A", capacity=5
        )
        self.section_b = Section.objects.create(
            semester=self.semester, name="B", capacity=5
        )
        self.subject = Subject.objects.create(
            semester=self.semester,
            code="TT1",
            name="Timetable Subject",
            type=SubjectType.LECTURE,
        )
        self.teacher_user = User.objects.create_user(
            username="tch-tt",
            email="tt@op.local",
            password="Passw0rd!",
            role=Role.TEACHER,
        )
        self.teacher = Teacher.objects.create(
            teacher_id="tch-tt", name="Dr. Timetable", email=self.teacher_user.email
        )
        self.teacher_user.teacher_profile = self.teacher
        self.teacher_user.save(update_fields=["teacher_profile"])

    def _slot(self, combined=False):
        slot = TimetableSlot.objects.create(
            semester=self.semester,
            section=self.section_a,
            subject=self.subject,
            teacher=self.teacher,
            day=DayOfWeek.MONDAY,
            start_time=time(9, 0),
            end_time=time(10, 0),
            room="T1",
            class_type="lecture",
            is_combined=combined,
        )
        return slot

    def test_single_section_serializer_enriches_names(self):
        self._slot()
        admin = User.objects.create_user(
            username="admin-tt",
            email="admintt@op.local",
            password="Passw0rd!",
            role=Role.ADMIN,
        )
        self.client.force_authenticate(user=admin)
        response = self.client.get("/api/academics/timetable/")
        self.assertEqual(response.status_code, 200)
        row = response.data["results"][0]
        self.assertEqual(row["subject_code"], self.subject.code)
        self.assertEqual(row["subject_name"], self.subject.name)
        self.assertEqual(row["teacher_name"], self.teacher.name)
        self.assertEqual(row["section_name"], "A")
        self.assertEqual(row["section_names"], ["A"])

    def test_combined_slot_reports_all_section_names(self):
        slot = self._slot(combined=True)
        slot.sections.add(self.section_a, self.section_b)
        admin = User.objects.create_user(
            username="admin-tt2",
            email="admintt2@op.local",
            password="Passw0rd!",
            role=Role.ADMIN,
        )
        self.client.force_authenticate(user=admin)
        response = self.client.get("/api/academics/timetable/")
        self.assertEqual(response.status_code, 200)
        row = response.data["results"][0]
        self.assertTrue(row["is_combined"])
        self.assertEqual(sorted(row["section_names"]), ["A", "B"])