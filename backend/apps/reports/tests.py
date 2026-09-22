from datetime import date, time

from django.contrib.auth import get_user_model

from rest_framework.test import APITestCase

from apps.academics.models import (
    AssignmentStatus,
    Section,
    Semester,
    SemesterStatus,
    Subject,
    SubjectType,
    TeacherAssignment,
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


class ReportsApiAuthTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@rep.local", password="Passw0rd!", role=Role.ADMIN
        )

        self.semester = Semester.objects.create(
            code="SEM-RP",
            name="Reports",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.section = Section.objects.create(
            semester=self.semester, name="A", capacity=10
        )
        self.subject = Subject.objects.create(
            semester=self.semester, code="RP1", name="Report Subject",
            type=SubjectType.LECTURE,
        )

        self.teacher_user = User.objects.create_user(
            email="t1@rep.local", password="Passw0rd!", role=Role.TEACHER
        )
        self.teacher = Teacher.objects.create(
            teacher_id="tch-rp1", name="T One", email="t1@rep.local"
        )
        self.teacher_user.teacher_profile = self.teacher
        self.teacher_user.save(update_fields=["teacher_profile"])
        TeacherAssignment.objects.create(
            teacher=self.teacher, semester=self.semester,
            section=self.section, subject=self.subject,
            status=AssignmentStatus.ACTIVE,
        )

        self.student_user = User.objects.create_user(
            email="s@rep.local", password="Passw0rd!", role=Role.STUDENT
        )
        self.student = Student.objects.create(
            student_id="std-rp", roll_no="01", name="Student",
            email="s@rep.local", section=self.section, semester=self.semester,
        )
        self.student_user.student_profile = self.student
        self.student_user.save(update_fields=["student_profile"])

        self.other_semester = Semester.objects.create(
            code="SEM-RP2",
            name="Other",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.other_section = Section.objects.create(
            semester=self.other_semester, name="B", capacity=10
        )
        self.other_subject = Subject.objects.create(
            semester=self.other_semester, code="RP2", name="Other Subject",
            type=SubjectType.LECTURE,
        )
        self.other_teacher_user = User.objects.create_user(
            email="t2@rep.local", password="Passw0rd!", role=Role.TEACHER
        )
        self.other_teacher = Teacher.objects.create(
            teacher_id="tch-rp2", name="T Two", email="t2@rep.local"
        )
        self.other_teacher_user.teacher_profile = self.other_teacher
        self.other_teacher_user.save(update_fields=["teacher_profile"])
        TeacherAssignment.objects.create(
            teacher=self.other_teacher, semester=self.other_semester,
            section=self.other_section, subject=self.other_subject,
            status=AssignmentStatus.ACTIVE,
        )
        self.other_student = Student.objects.create(
            student_id="std-rp2", roll_no="01", name="Other",
            email="other@rep.local", section=self.other_section,
            semester=self.other_semester,
        )

        self.session = self._make_session(
            self.teacher, self.subject, self.section
        )
        self._mark(self.session, self.student, AttendanceStatus.PRESENT)
        self.other_session = self._make_session(
            self.other_teacher, self.other_subject, self.other_section
        )
        self._mark(self.other_session, self.other_student, AttendanceStatus.ABSENT)

    def _make_session(self, teacher, subject, section):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=subject,
            teacher=teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        session.sections.add(section)
        return session

    def _mark(self, session, student, status):
        AttendanceRecord.objects.create(
            attendance_session=session,
            student=student,
            status=status,
            marking_complete=True,
        )

    def test_anonymous_and_student_blocked(self):
        anon = self.client.get("/api/reports/summary/")
        self.assertEqual(anon.status_code, 401)

        self.client.force_authenticate(user=self.student_user)
        denied = self.client.get("/api/reports/summary/")
        self.assertEqual(denied.status_code, 403)

    def test_admin_sees_everything(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/reports/summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totalAttendanceSessions"], 2)
        self.assertEqual(response.data["totalStudents"], 2)
        self.assertEqual(response.data["present"], 1)
        self.assertEqual(response.data["absent"], 1)

    def test_teacher_summary_is_scoped(self):
        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/reports/summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totalAttendanceSessions"], 1)
        self.assertEqual(response.data["totalStudents"], 1)
        self.assertEqual(response.data["present"], 1)
        self.assertEqual(len(response.data["studentsAtRisk"]), 0)

    def test_by_subject_honors_semester_and_scope(self):
        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/reports/by-subject/")
        self.assertEqual(response.status_code, 200)
        names = [row["subjectName"] for row in response.data]
        self.assertEqual(names, ["Report Subject"])
        self.assertNotIn("Other Subject", names)

        self.client.force_authenticate(user=self.admin)
        scoped = self.client.get(
            "/api/reports/by-subject/", {"semester": self.other_semester.pk}
        )
        names = [row["subjectName"] for row in scoped.data]
        self.assertEqual(names, ["Other Subject"])

    def test_at_risk_reveals_only_own_students(self):
        self.client.force_authenticate(user=self.other_teacher_user)
        response = self.client.get("/api/reports/summary/")
        self.assertEqual(response.data["totalAttendanceSessions"], 1)
        at_risk = response.data["studentsAtRisk"]
        self.assertEqual(
            [row["studentId"] for row in at_risk], [self.other_student.pk]
        )

    def test_late_counts_as_attended_in_percentages(self):
        # A second session for the same student, marked LATE. Percentages must
        # treat late as attended: (1 present + 1 late) / 2 marked = 100%.
        late_session = self._make_session(self.teacher, self.subject, self.section)
        self._mark(late_session, self.student, AttendanceStatus.LATE)
        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/reports/summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["attendancePercentage"], 100.0)
        self.assertEqual(response.data["late"], 1)
        # An all-attended student is NOT at risk (late = attended).
        self.assertEqual(len(response.data["studentsAtRisk"]), 0)
        by_subject = self.client.get("/api/reports/by-subject/")
        self.assertEqual(by_subject.status_code, 200)
        row = [
            r for r in by_subject.data
            if r["subjectId"] == self.subject.pk
        ][0]
        self.assertEqual(row["percentage"], 100.0)


class AdminAnalyticsApiTests(APITestCase):
    """Institution-wide `/api/reports/admin/` endpoint (admin-only).

    The admin dashboard and admin reports view consume this single payload so
    they never depend on mock numbers or secondary list endpoints. Teachers
    keep using the scoped `/summary/` contract and must be blocked here.
    """

    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@admin.local", password="Passw0rd!", role=Role.ADMIN
        )

        self.semester = Semester.objects.create(
            code="SEM-AD",
            name="Admin Analytics",
            academic_year="2026-2027",
            start_date=date(2026, 9, 1),
            end_date=date(2027, 1, 15),
            status=SemesterStatus.ACTIVE,
        )
        self.section = Section.objects.create(
            semester=self.semester, name="A", capacity=10
        )
        self.subject = Subject.objects.create(
            semester=self.semester, code="AD1", name="Admin Subject",
            type=SubjectType.LECTURE, credits=4,
        )

        self.teacher_user = User.objects.create_user(
            email="ta@admin.local", password="Passw0rd!", role=Role.TEACHER
        )
        self.teacher = Teacher.objects.create(
            teacher_id="tch-ad", name="T Admin", email="ta@admin.local"
        )
        self.teacher_user.teacher_profile = self.teacher
        self.teacher_user.save(update_fields=["teacher_profile"])
        TeacherAssignment.objects.create(
            teacher=self.teacher, semester=self.semester,
            section=self.section, subject=self.subject,
            status=AssignmentStatus.ACTIVE,
        )

        self.student = Student.objects.create(
            student_id="std-ad", roll_no="01", name="Student",
            email="sa@admin.local", section=self.section, semester=self.semester,
            guardian_name="Guardian A", guardian_phone="0000000000",
        )
        self.student_user = User.objects.create_user(
            email="sa@admin.local", password="Passw0rd!", role=Role.STUDENT
        )
        self.student_user.student_profile = self.student
        self.student_user.save(update_fields=["student_profile"])

        self.session = self._make_session(self.subject, self.section)
        self._mark(self.session, self.student, AttendanceStatus.PRESENT)

    def _make_session(self, subject, section):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        session.sections.add(section)
        return session

    def _mark(self, session, student, status):
        AttendanceRecord.objects.create(
            attendance_session=session,
            student=student,
            status=status,
            marking_complete=True,
        )

    def test_requires_admin(self):
        self.client.force_authenticate(user=self.student_user)
        self.assertEqual(
            self.client.get("/api/reports/admin/").status_code, 403
        )
        self.client.force_authenticate(user=self.teacher_user)
        self.assertEqual(
            self.client.get("/api/reports/admin/").status_code, 403
        )
        self.client.force_authenticate(user=None)
        self.assertEqual(
            self.client.get("/api/reports/admin/").status_code, 401
        )

    def test_counts_and_attendance_aggregates(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/reports/admin/")
        self.assertEqual(response.status_code, 200)
        counts = response.data["counts"]
        self.assertEqual(counts["totalStudents"], 1)
        self.assertEqual(counts["totalTeachers"], 1)
        self.assertEqual(counts["totalSemesters"], 1)
        self.assertEqual(counts["activeSemesters"], 1)
        self.assertEqual(counts["totalSections"], 1)
        self.assertEqual(counts["totalSubjects"], 1)
        attendance = response.data["attendance"]
        self.assertEqual(attendance["totalAttendanceSessions"], 1)
        self.assertEqual(attendance["totalMarked"], 1)
        self.assertEqual(attendance["present"], 1)
        self.assertEqual(attendance["late"], 0)
        self.assertEqual(attendance["absent"], 0)
        self.assertEqual(attendance["attendancePercentage"], 100.0)

    def test_student_roster_includes_unmarked_students_as_null(self):
        unmarked = Student.objects.create(
            student_id="std-ad2", roll_no="02", name="No Marks",
            email="nm@admin.local", section=self.section, semester=self.semester,
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/reports/admin/")
        roster = {
            r["studentId"]: r for r in response.data["studentRoster"]
        }
        self.assertIn(self.student.pk, roster)
        self.assertIn(unmarked.pk, roster)
        self.assertEqual(roster[self.student.pk]["percentage"], 100.0)
        self.assertEqual(roster[self.student.pk]["present"], 1)
        # A student with zero marks must NOT look like a defaulter.
        self.assertIsNone(roster[unmarked.pk]["percentage"])
        self.assertEqual(roster[unmarked.pk]["marked"], 0)

    def test_at_risk_and_section_rows(self):
        session2 = self._make_session(self.subject, self.section)
        self._mark(session2, self.student, AttendanceStatus.ABSENT)
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/reports/admin/")
        self.assertEqual(response.data["attendance"]["attendancePercentage"], 50.0)
        at_risk = response.data["studentsAtRisk"]
        self.assertEqual(
            [row["studentId"] for row in at_risk], [self.student.pk]
        )
        self.assertEqual(len(response.data["bySubject"]), 1)
        sections = response.data["bySection"]
        self.assertEqual(len(sections), 1)
        self.assertEqual(sections[0]["studentCount"], 1)
        self.assertEqual(sections[0]["sessions"], 2)

    def test_by_subject_carries_code_semester_and_credits(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/reports/admin/")
        row = response.data["bySubject"][0]
        self.assertEqual(row["subjectCode"], "AD1")
        self.assertEqual(row["subjectName"], "Admin Subject")
        self.assertEqual(row["semesterId"], self.semester.pk)
        self.assertEqual(row["semesterName"], self.semester.name)
        self.assertEqual(row["credits"], 4)
        self.assertEqual(row["sessions"], 1)
        self.assertEqual(row["percentage"], 100.0)


class AdminAnalyticsEmptyTests(APITestCase):
    """A fresh institution with zero students/sessions must not error and
    must never fabricate defaulters."""

    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@empty.local", password="Passw0rd!", role=Role.ADMIN
        )

    def test_empty_institution_is_harmless(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/reports/admin/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["counts"]["totalStudents"], 0)
        self.assertEqual(response.data["attendance"]["totalMarked"], 0)
        self.assertEqual(response.data["studentsAtRisk"], [])
        self.assertEqual(response.data["studentRoster"], [])