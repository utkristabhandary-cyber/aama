from datetime import date, time, timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone

from rest_framework.test import APITestCase

from apps.academics.models import (
    AssignmentStatus,
    Semester,
    SemesterStatus,
    Section,
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
    QRAttendanceSession,
    generate_token,
)
from apps.attendance.services import (
    build_qr_payload,
    finalize_attendance_session,
    mark_qr_student,
    start_qr_session,
    validate_qr,
)
from apps.students.models import Student
from apps.teachers.models import Teacher

User = get_user_model()


class AttendanceBase(APITestCase):
    def setUp(self):
        self.teacher_user = User.objects.create_user(
            email="teacher@test.local", password="Passw0rd!", role=Role.TEACHER
        )
        self.teacher = Teacher.objects.create(
            teacher_id="tch-qr", name="Dr. QR", email=self.teacher_user.email
        )
        self.teacher_user.teacher_profile = self.teacher
        self.teacher_user.save(update_fields=["teacher_profile"])

        self.student_user = User.objects.create_user(
            email="student@test.local", password="Passw0rd!", role=Role.STUDENT
        )
        semester = Semester.objects.create(
            code="SEM-QR",
            name="QR Semester",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.section = Section.objects.create(semester=semester, name="A", capacity=5)
        self.subject = Subject.objects.create(
            semester=semester, code="QR1", name="QR Subject", type=SubjectType.LECTURE
        )
        self.student = Student.objects.create(
            student_id="std-1",
            roll_no="101",
            name="Ananya",
            email=self.student_user.email,
            section=self.section,
            semester=semester,
        )
        self.student_user.student_profile = self.student
        self.student_user.save(update_fields=["student_profile"])
        self.other_student = Student.objects.create(
            student_id="std-2",
            roll_no="102",
            name="Rohan",
            email="rohan@test.local",
            section=self.section,
            semester=semester,
        )


class AttendanceMarkingTests(AttendanceBase):
    def setUp(self):
        super().setUp()
        self.session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        self.session.sections.add(self.section)

    def test_unmarked_student_has_no_record(self):
        self.assertEqual(self.session.attendance_records.count(), 0)

    def test_attendance_is_never_auto_present(self):
        self.assertFalse(self.session.is_auto_present)
        mark_qr_student(
            self.session, self.student, AttendanceStatus.PRESENT.value
        )
        # The student who did NOT attend has NO row -> stays UNMARKED, not absent/present.
        self.assertEqual(self.session.attendance_records.count(), 1)
        self.assertEqual(
            AttendanceRecord.objects.filter(
                attendance_session=self.session, student=self.other_student
            ).count(),
            0,
        )

    def test_finalize_keeps_unmarked_students_unmarked(self):
        mark_qr_student(
            self.session, self.student, AttendanceStatus.PRESENT.value
        )
        finalize_attendance_session(self.session, marked_ids=[self.student.pk])
        self.assertTrue(self.session.is_finalized)
        marked = self.session.attendance_records.all()
        self.assertEqual(list(marked.values_list("status", flat=True)), ["present"])

    def test_one_record_per_student(self):
        mark_qr_student(
            self.session, self.student, AttendanceStatus.PRESENT.value
        )
        mark_qr_student(self.session, self.student, AttendanceStatus.LATE.value)
        self.assertEqual(self.session.attendance_records.count(), 1)
        record = self.session.attendance_records.get(student=self.student)
        self.assertEqual(record.status, AttendanceStatus.LATE)


class QRAttendanceTests(AttendanceBase):
    def test_payload_and_validation_flow(self):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session.sections.add(self.section)
        qr = start_qr_session(self.teacher, session)
        token = qr.get_current_token()
        self.assertEqual(len(token), 9)
        payload = build_qr_payload(qr)
        self.assertTrue(payload.startswith("AAMSQR1|"))
        self.assertIn(token, payload)

        valid, message, info = validate_qr(qr.pk, "XXXX-XXXX")
        self.assertFalse(valid)

        valid, message, info = validate_qr(qr.pk, token)
        self.assertTrue(valid)
        self.assertIsNotNone(info)
        self.assertEqual(info["attendanceSessionId"], session.pk)

        # Replay by a different text is rejected only if token expired/incorrect;
        # a stale (server-side rotated) token must not pass.
        qr.rotate()
        valid, message, _ = validate_qr(qr.pk, token)
        self.assertFalse(valid)

    def test_one_active_qr_session_per_teacher(self):
        session_a = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session_b = AttendanceSession.objects.create(
            session_date=date(2026, 9, 8),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        qr1 = start_qr_session(self.teacher, session_a)
        qr2 = start_qr_session(self.teacher, session_b)
        self.assertEqual(qr1.pk, qr2.pk)
        self.assertEqual(
            QRAttendanceSession.objects.filter(
                teacher=self.teacher, revoked=False
            ).count(),
            1,
        )

    def test_retarget_persists_attendance_session_and_resets_ledger(self):
        session_a = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session_b = AttendanceSession.objects.create(
            session_date=date(2026, 9, 8),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        qr = start_qr_session(self.teacher, session_a)
        qr.student_ids = [self.student.pk]
        qr.save(update_fields=["student_ids"])

        # Regression: re-targeting used to mutate only the in-memory object —
        # rotate() persists just the token fields, so the DB kept pointing the
        # QR at the previous session with a stale ledger.
        start_qr_session(self.teacher, session_b)
        reloaded = QRAttendanceSession.objects.get(pk=qr.pk)
        self.assertEqual(reloaded.attendance_session_id, session_b.pk)
        self.assertEqual(reloaded.student_ids, [])

    def test_mark_then_submit_then_block(self):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session.sections.add(self.section)
        qr = start_qr_session(self.teacher, session)
        token = qr.get_current_token()

        mark_qr_student(session, self.student, AttendanceStatus.PRESENT.value)
        finalize_attendance_session(session, marked_ids=[self.student.pk])
        self.assertTrue(session.is_finalized)

        valid, message, _ = validate_qr(qr.pk, token)
        self.assertFalse(valid)
        self.assertIn("submitted", message)


class AttendanceApiAuthTests(AttendanceBase):
    """HTTP-level authorization for attendance session management."""

    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(
            email="admin@att.local", password="Passw0rd!", role=Role.ADMIN
        )
        TeacherAssignment.objects.create(
            teacher=self.teacher,
            semester=self.section.semester,
            section=self.section,
            subject=self.subject,
            status=AssignmentStatus.ACTIVE,
        )

    def _as(self, user):
        self.client.force_authenticate(user=user)

    def _session_payload(self):
        return {
            "session_date": "2026-09-07",
            "subject": self.subject.pk,
            "phase": "manual",
            "start_time": "11:00",
            "planned_end_time": "12:00",
            "section_ids": [self.section.pk],
        }

    @staticmethod
    def _other_teacher(email="o@att.local"):
        return Teacher.objects.create(
            teacher_id=f"tch-{email.split('@')[0]}", name="Other", email=email
        )

    def test_anonymous_cannot_list_sessions(self):
        response = self.client.get("/api/attendance/sessions/")
        self.assertEqual(response.status_code, 401)

    def test_student_cannot_create_session(self):
        self._as(self.student_user)
        response = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_teacher_creates_own_session(self):
        self._as(self.teacher_user)
        response = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        self.assertEqual(response.status_code, 201)
        session = AttendanceSession.objects.get(pk=response.data["id"])
        self.assertEqual(session.teacher, self.teacher)
        self.assertEqual(session.created_by, self.teacher_user)

    def test_teacher_cannot_assign_another_teacher(self):
        self._as(self.teacher_user)
        payload = self._session_payload()
        payload["teacher"] = self.admin.pk
        response = self.client.post(
            "/api/attendance/sessions/", payload, format="json"
        )
        self.assertEqual(response.status_code, 201)
        session = AttendanceSession.objects.get(pk=response.data["id"])
        self.assertEqual(session.teacher, self.teacher)

    def test_unassigned_section_rejected(self):
        other = Section.objects.create(
            semester=self.section.semester, name="B", capacity=5
        )
        self._as(self.teacher_user)
        payload = self._session_payload()
        payload["section_ids"] = [other.pk]
        response = self.client.post(
            "/api/attendance/sessions/", payload, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_teacher_sees_only_own_sessions(self):
        other_teacher = self._other_teacher()
        other_user = User.objects.create_user(
            email=other_teacher.email, password="Passw0rd!", role=Role.TEACHER
        )
        other_user.teacher_profile = other_teacher
        other_user.save(update_fields=["teacher_profile"])
        other_session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=other_teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        other_session.sections.add(self.section)

        self._as(self.teacher_user)
        response = self.client.get("/api/attendance/sessions/")
        self.assertEqual(response.status_code, 200)
        ids = [row["id"] for row in response.data["results"]]
        self.assertNotIn(other_session.pk, ids)

    def test_cannot_mark_other_teachers_session(self):
        other_teacher = self._other_teacher("om@att.local")
        other_user = User.objects.create_user(
            email=other_teacher.email, password="Passw0rd!", role=Role.TEACHER
        )
        other_user.teacher_profile = other_teacher
        other_user.save(update_fields=["teacher_profile"])
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=other_teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        session.sections.add(self.section)
        self._as(self.teacher_user)
        mark = self.client.post(
            f"/api/attendance/sessions/{session.pk}/mark/",
            {"studentId": self.student.pk, "status": "absent"},
            format="json",
        )
        # get_object() scopes to own sessions first, so an outsider's session
        # surfaces as not-found (handler maps it to 400) — either way, blocked.
        self.assertIn(mark.status_code, (400, 404))

    def test_mark_records_attendance_for_owner(self):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session.sections.add(self.section)
        self._as(self.teacher_user)
        mark = self.client.post(
            f"/api/attendance/sessions/{session.pk}/mark/",
            {"studentId": self.student.pk, "status": "present"},
            format="json",
        )
        self.assertEqual(mark.status_code, 200)
        record = AttendanceRecord.objects.get(
            student=self.student, attendance_session=session
        )
        self.assertEqual(record.status, AttendanceStatus.PRESENT)

    def test_finalized_session_rejects_mutation(self):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session.sections.add(self.section)
        self._as(self.teacher_user)
        submit = self.client.post(
            f"/api/attendance/sessions/{session.pk}/submit/", {}, format="json"
        )
        self.assertEqual(submit.status_code, 200)
        patch = self.client.patch(
            f"/api/attendance/sessions/{session.pk}/",
            {"end_time": "12:30"},
            format="json",
        )
        self.assertEqual(patch.status_code, 403)
        delete = self.client.delete(f"/api/attendance/sessions/{session.pk}/")
        self.assertEqual(delete.status_code, 403)

    def test_concurrent_duplicate_session_rejected(self):
        self._as(self.teacher_user)
        first = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        self.assertEqual(first.status_code, 201)
        second = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        self.assertEqual(second.status_code, 400)
        self.assertIn("section_ids", second.data["detail"])
        self.assertEqual(
            AttendanceSession.objects.filter(teacher=self.teacher).count(), 1
        )

    def test_same_subject_different_section_allowed_same_day(self):
        section_b = Section.objects.create(
            semester=self.section.semester, name="B", capacity=5
        )
        TeacherAssignment.objects.create(
            teacher=self.teacher,
            semester=self.section.semester,
            section=section_b,
            subject=self.subject,
            status=AssignmentStatus.ACTIVE,
        )
        self._as(self.teacher_user)
        payload_a = self._session_payload()
        payload_b = self._session_payload()
        payload_b["section_ids"] = [section_b.pk]
        first = self.client.post(
            "/api/attendance/sessions/", payload_a, format="json"
        )
        self.assertEqual(first.status_code, 201)
        second = self.client.post(
            "/api/attendance/sessions/", payload_b, format="json"
        )
        self.assertEqual(second.status_code, 201)

    def test_session_serializer_exposes_display_fields(self):
        self._as(self.teacher_user)
        created = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        self.assertEqual(created.status_code, 201)
        detail = self.client.get(
            f"/api/attendance/sessions/{created.data['id']}/"
        )
        self.assertEqual(detail.status_code, 200)
        data = detail.data
        self.assertEqual(data["subject_code"], self.subject.code)
        self.assertEqual(data["subject_name"], self.subject.name)
        self.assertEqual(data["teacher_name"], self.teacher.name)
        self.assertEqual(data["section_names"], [self.section.name])
        self.assertEqual(data["semester_id"], self.section.semester_id)
        self.assertEqual(data["semester_name"], self.section.semester.name)
        self.assertFalse(data["is_finalized"])
        self.assertEqual(data["attendance_ids"], [])

    def test_admin_list_filters_by_subject_and_section(self):
        section_b = Section.objects.create(
            semester=self.section.semester, name="B", capacity=5
        )
        subject_b = Subject.objects.create(
            semester=self.section.semester, code="QR2", name="Second Subject"
        )
        TeacherAssignment.objects.create(
            teacher=self.teacher,
            semester=self.section.semester,
            section=section_b,
            subject=subject_b,
            status=AssignmentStatus.ACTIVE,
        )
        self._as(self.teacher_user)
        payload_a = self._session_payload()
        payload_b = {
            "session_date": "2026-09-07",
            "subject": subject_b.pk,
            "phase": "manual",
            "start_time": "13:00",
            "planned_end_time": "14:00",
            "section_ids": [section_b.pk],
        }
        a = self.client.post("/api/attendance/sessions/", payload_a, format="json")
        b = self.client.post("/api/attendance/sessions/", payload_b, format="json")
        self.assertEqual(a.status_code, 201)
        self.assertEqual(b.status_code, 201)

        self._as(self.admin)
        by_subject = self.client.get(
            "/api/attendance/sessions/", {"subject": subject_b.pk}
        )
        ids = [row["id"] for row in by_subject.data["results"]]
        self.assertEqual(ids, [b.data["id"]])

        by_section = self.client.get(
            "/api/attendance/sessions/", {"section": self.section.pk}
        )
        ids = [row["id"] for row in by_section.data["results"]]
        self.assertEqual(ids, [a.data["id"]])


class AttendanceWorkflowLifecycleTests(AttendanceApiAuthTests):
    """End-to-end teacher roll-call workflow against the live API."""

    def test_full_roll_call_workflow(self):
        guest = Student.objects.create(
            student_id="std-3",
            roll_no="103",
            name="Guest",
            email="guest@test.local",
            section=self.section,
            semester=self.section.semester,
        )
        self._as(self.teacher_user)
        created = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        self.assertEqual(created.status_code, 201)
        session_id = created.data["id"]

        roll = self.client.get(f"/api/attendance/sessions/{session_id}/roll/")
        self.assertEqual(roll.status_code, 200)
        roster = {row["studentId"]: row for row in roll.data["students"]}
        self.assertEqual(len(roster), 3)
        self.assertIsNone(roster[self.student.pk]["status"])
        self.assertFalse(roster[self.student.pk]["marked"])

        mark1 = self.client.post(
            f"/api/attendance/sessions/{session_id}/mark/",
            {"studentId": self.student.pk, "status": "present"},
            format="json",
        )
        self.assertEqual(mark1.status_code, 200)
        mark2 = self.client.post(
            f"/api/attendance/sessions/{session_id}/mark/",
            {"studentId": self.other_student.pk, "status": "absent"},
            format="json",
        )
        self.assertEqual(mark2.status_code, 200)

        refresh_roll = self.client.get(
            f"/api/attendance/sessions/{session_id}/roll/"
        )
        marked = {row["studentId"]: row for row in refresh_roll.data["students"]}
        self.assertEqual(marked[self.student.pk]["status"], "present")
        self.assertEqual(marked[self.other_student.pk]["status"], "absent")
        self.assertIsNone(marked[guest.pk]["status"])

        submit = self.client.post(
            f"/api/attendance/sessions/{session_id}/submit/",
            {"markedIds": [self.student.pk, self.other_student.pk], "lateReason": "Lab"},
            format="json",
        )
        self.assertEqual(submit.status_code, 200)
        self.assertTrue(submit.data["is_finalized"])
        self.assertIsNotNone(submit.data["submitted_at"])

        records = {
            r.student_id: r.status
            for r in AttendanceRecord.objects.filter(
                attendance_session_id=session_id
            )
        }
        self.assertEqual(records[self.student.pk], AttendanceStatus.PRESENT)
        self.assertEqual(records[self.other_student.pk], AttendanceStatus.ABSENT)
        self.assertNotIn(guest.pk, records)

        blocked_mark = self.client.post(
            f"/api/attendance/sessions/{session_id}/mark/",
            {"studentId": guest.pk, "status": "present"},
            format="json",
        )
        self.assertEqual(blocked_mark.status_code, 400)
        blocked_submit = self.client.post(
            f"/api/attendance/sessions/{session_id}/submit/", {}, format="json"
        )
        self.assertEqual(blocked_submit.status_code, 400)
        blocked_delete = self.client.delete(
            f"/api/attendance/sessions/{session_id}/"
        )
        self.assertEqual(blocked_delete.status_code, 403)

    def test_mark_student_late_via_api(self):
        self._as(self.teacher_user)
        created = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        session_id = created.data["id"]
        mark = self.client.post(
            f"/api/attendance/sessions/{session_id}/mark/",
            {"studentId": self.student.pk, "status": "late"},
            format="json",
        )
        self.assertEqual(mark.status_code, 200)
        self.assertEqual(mark.data["status"], "late")
        record = AttendanceRecord.objects.get(
            student=self.student, attendance_session_id=session_id
        )
        self.assertTrue(record.marking_complete)

    def test_bulk_mark_applies_all_valid_statuses(self):
        self._as(self.teacher_user)
        created = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        session_id = created.data["id"]
        response = self.client.post(
            f"/api/attendance/sessions/{session_id}/bulk_mark/",
            {"marks": [
                {"studentId": self.student.pk, "status": "present"},
                {"studentId": self.other_student.pk, "status": "absent"},
            ]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        records = {
            r.student_id: r.status
            for r in AttendanceRecord.objects.filter(attendance_session_id=session_id)
        }
        self.assertEqual(records[self.student.pk], AttendanceStatus.PRESENT)
        self.assertEqual(records[self.other_student.pk], AttendanceStatus.ABSENT)
        self.assertEqual(len(records), 2)

    def test_bulk_mark_is_atomic_rejects_any_invalid_student(self):
        other_section = Section.objects.create(
            semester=self.section.semester, name="X", capacity=5
        )
        outside = Student.objects.create(
            student_id="std-out", roll_no="777", name="Outside",
            email="outside@att.local", section=other_section,
            semester=self.section.semester,
        )
        self._as(self.teacher_user)
        created = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        session_id = created.data["id"]
        response = self.client.post(
            f"/api/attendance/sessions/{session_id}/bulk_mark/",
            {"marks": [
                {"studentId": self.student.pk, "status": "present"},
                {"studentId": outside.pk, "status": "absent"},
            ]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        # Atomicity: nothing at all was written, not even the valid student.
        self.assertEqual(
            AttendanceRecord.objects.filter(attendance_session_id=session_id).count(), 0
        )

    def test_bulk_mark_finalized_session_rejected(self):
        self._as(self.teacher_user)
        created = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        session_id = created.data["id"]
        self.client.post(
            f"/api/attendance/sessions/{session_id}/submit/", {}, format="json"
        )
        response = self.client.post(
            f"/api/attendance/sessions/{session_id}/bulk_mark/",
            {"marks": [{"studentId": self.student.pk, "status": "present"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_bulk_mark_student_cannot_use(self):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        session.sections.add(self.section)
        self._as(self.student_user)
        response = self.client.post(
            f"/api/attendance/sessions/{session.pk}/bulk_mark/",
            {"marks": [{"studentId": self.student.pk, "status": "present"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_delete_another_teachers_draft(self):
        other_teacher = self._other_teacher("ad-del@att.local")
        other_user = User.objects.create_user(
            email=other_teacher.email, password="Passw0rd!", role=Role.TEACHER
        )
        other_user.teacher_profile = other_teacher
        other_user.save(update_fields=["teacher_profile"])
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=other_teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        session.sections.add(self.section)
        self._as(self.admin)
        delete = self.client.delete(f"/api/attendance/sessions/{session.pk}/")
        self.assertEqual(delete.status_code, 204)
        self.assertEqual(AttendanceSession.objects.filter(pk=session.pk).count(), 0)

    def test_admin_cannot_delete_finalized_session(self):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        session.sections.add(self.section)
        self.client.force_authenticate(user=self.admin)
        submit = self.client.post(
            f"/api/attendance/sessions/{session.pk}/submit/", {}, format="json"
        )
        self.assertEqual(submit.status_code, 200)
        delete = self.client.delete(f"/api/attendance/sessions/{session.pk}/")
        self.assertEqual(delete.status_code, 403)

    def test_roll_empty_section_is_empty(self):
        empty_section = Section.objects.create(
            semester=self.section.semester, name="E", capacity=5
        )
        TeacherAssignment.objects.create(
            teacher=self.teacher,
            semester=self.section.semester,
            section=empty_section,
            subject=self.subject,
            status=AssignmentStatus.ACTIVE,
        )
        self._as(self.teacher_user)
        payload = self._session_payload()
        payload["section_ids"] = [empty_section.pk]
        created = self.client.post(
            "/api/attendance/sessions/", payload, format="json"
        )
        self.assertEqual(created.status_code, 201)
        roll = self.client.get(
            f"/api/attendance/sessions/{created.data['id']}/roll/"
        )
        self.assertEqual(roll.status_code, 200)
        self.assertEqual(roll.data["students"], [])

    def test_session_for_completed_semester_rejected(self):
        completed = Semester.objects.create(
            code="SEM-PA",
            name="Past Semester",
            academic_year="2024-2025",
            start_date=date(2025, 1, 12),
            end_date=date(2025, 5, 22),
            status=SemesterStatus.COMPLETED,
        )
        past_section = Section.objects.create(
            semester=completed, name="A", capacity=5
        )
        past_subject = Subject.objects.create(
            semester=completed, code="OLD1", name="Past Subject"
        )
        TeacherAssignment.objects.create(
            teacher=self.teacher,
            semester=completed,
            section=past_section,
            subject=past_subject,
            status=AssignmentStatus.ACTIVE,
        )
        self._as(self.teacher_user)
        payload = {
            "session_date": "2025-02-10",
            "subject": past_subject.pk,
            "phase": "manual",
            "start_time": "09:00",
            "planned_end_time": "10:00",
            "section_ids": [past_section.pk],
        }
        response = self.client.post(
            "/api/attendance/sessions/", payload, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_cross_semester_stats_are_scoped(self):
        # A student's own summary must never mix records from another semester.
        self._as(self.teacher_user)
        first = self.client.post(
            "/api/attendance/sessions/", self._session_payload(), format="json"
        )
        self.assertEqual(first.status_code, 201)
        self.client.post(
            f"/api/attendance/sessions/{first.data['id']}/mark/",
            {"studentId": self.student.pk, "status": "present"},
            format="json",
        )
        self.client.force_authenticate(user=self.student_user)
        response = self.client.get("/api/attendance/records/my/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["overallTotal"], 1)
        # A different semester has no records for this student -> empty summary.
        other_semester = Semester.objects.create(
            code="SEM-2",
            name="Second",
            academic_year="2026-2027",
            start_date=date(2026, 9, 1),
            end_date=date(2026, 12, 20),
            status=SemesterStatus.ACTIVE,
        )
        scoped = self.client.get(
            "/api/attendance/records/my/", {"semester": other_semester.pk}
        )
        self.assertEqual(scoped.status_code, 200)
        self.assertEqual(scoped.data["overallTotal"], 0)


class QRAttendanceApiAuthTests(AttendanceBase):
    """HTTP-level security for the QR roll-call flow."""

    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(
            email="admin@qr.test.local", password="Passw0rd!", role=Role.ADMIN
        )
        self.other_student_user = User.objects.create_user(
            email="other.student@test.local",
            password="Passw0rd!",
            role=Role.STUDENT,
        )
        self.other_student_user.student_profile = self.other_student
        self.other_student_user.save(update_fields=["student_profile"])

    def _create_qr_session(self):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session.sections.add(self.section)
        return session

    def _start_for_teacher(self):
        session = self._create_qr_session()
        self.client.force_authenticate(user=self.teacher_user)
        start = self.client.post(
            "/api/attendance/qr/start/",
            {"attendanceSessionId": session.pk},
            format="json",
        )
        self.assertEqual(start.status_code, 200)
        return session, start.data

    def test_student_cannot_start_or_list(self):
        self.client.force_authenticate(user=self.student_user)
        start = self.client.post(
            "/api/attendance/qr/start/", {}, format="json"
        )
        self.assertEqual(start.status_code, 403)
        listing = self.client.get("/api/attendance/qr/")
        self.assertEqual(listing.status_code, 403)

    def test_student_marks_once_with_valid_token(self):
        session, data = self._start_for_teacher()
        qr = QRAttendanceSession.objects.get(pk=data["id"])

        self.client.force_authenticate(user=self.student_user)
        mark = self.client.post(
            f"/api/attendance/qr/{qr.pk}/mark/",
            {"code": data["token"]},
            format="json",
        )
        self.assertEqual(mark.status_code, 200)
        record = AttendanceRecord.objects.get(
            student=self.student, attendance_session=session
        )
        self.assertEqual(record.status, AttendanceStatus.PRESENT)

        replay = self.client.post(
            f"/api/attendance/qr/{qr.pk}/mark/",
            {"code": data["token"]},
            format="json",
        )
        self.assertEqual(replay.status_code, 400)

    def test_two_students_share_one_token(self):
        session, data = self._start_for_teacher()
        qr = QRAttendanceSession.objects.get(pk=data["id"])

        self.client.force_authenticate(user=self.student_user)
        r1 = self.client.post(
            f"/api/attendance/qr/{qr.pk}/mark/",
            {"code": data["token"]},
            format="json",
        )
        self.assertEqual(r1.status_code, 200)

        self.client.force_authenticate(user=self.other_student_user)
        r2 = self.client.post(
            f"/api/attendance/qr/{qr.pk}/mark/",
            {"code": data["token"]},
            format="json",
        )
        self.assertEqual(r2.status_code, 200)

        self.assertEqual(
            AttendanceRecord.objects.filter(attendance_session=session).count(), 2
        )
        qr.refresh_from_db()
        self.assertEqual(len(qr.student_ids), 2)

    def test_recognised_student_cannot_spoof_identity(self):
        session, data = self._start_for_teacher()
        qr = QRAttendanceSession.objects.get(pk=data["id"])

        self.client.force_authenticate(user=self.student_user)
        mark = self.client.post(
            f"/api/attendance/qr/{qr.pk}/mark/",
            {"code": data["token"], "studentId": self.other_student.pk},
            format="json",
        )
        self.assertEqual(mark.status_code, 200)
        self.assertTrue(
            AttendanceRecord.objects.filter(
                attendance_session=session, student=self.student
            ).exists()
        )
        self.assertFalse(
            AttendanceRecord.objects.filter(
                attendance_session=session, student=self.other_student
            ).exists()
        )

    def test_student_outside_section_rejected(self):
        other_section = Section.objects.create(
            semester=self.section.semester, name="X", capacity=5
        )
        outside_user = User.objects.create_user(
            email="outside@test.local", password="Passw0rd!", role=Role.STUDENT
        )
        outside_student = Student.objects.create(
            student_id="std-x",
            roll_no="999",
            name="Outside",
            email=outside_user.email,
            section=other_section,
            semester=self.section.semester,
        )
        outside_user.student_profile = outside_student
        outside_user.save(update_fields=["student_profile"])

        session, data = self._start_for_teacher()
        qr = QRAttendanceSession.objects.get(pk=data["id"])

        self.client.force_authenticate(user=outside_user)
        mark = self.client.post(
            f"/api/attendance/qr/{qr.pk}/mark/",
            {"code": data["token"]},
            format="json",
        )
        # The QR is scoped out of reach for this student: it is not discoverable
        # and resolves to 404 (no existence oracle for other sections).
        self.assertEqual(mark.status_code, 404)
        self.assertEqual(
            AttendanceRecord.objects.filter(attendance_session=session).count(), 0
        )

    def test_stopped_session_rejects_marks(self):
        session, data = self._start_for_teacher()
        qr = QRAttendanceSession.objects.get(pk=data["id"])

        stop = self.client.post(f"/api/attendance/qr/{qr.pk}/stop/")
        self.assertEqual(stop.status_code, 200)

        self.client.force_authenticate(user=self.student_user)
        mark = self.client.post(
            f"/api/attendance/qr/{qr.pk}/mark/",
            {"code": data["token"]},
            format="json",
        )
        self.assertEqual(mark.status_code, 400)

    def test_submitted_session_rejects_marks(self):
        session, data = self._start_for_teacher()
        qr = QRAttendanceSession.objects.get(pk=data["id"])

        submit = self.client.post(
            f"/api/attendance/sessions/{session.pk}/submit/", {}, format="json"
        )
        self.assertEqual(submit.status_code, 200)

        self.client.force_authenticate(user=self.student_user)
        mark = self.client.post(
            f"/api/attendance/qr/{qr.pk}/mark/",
            {"code": data["token"]},
            format="json",
        )
        self.assertEqual(mark.status_code, 400)


class QrSecurityApiTests(AttendanceBase):
    """Phase 6: attack surface of the server-authoritative QR check-in endpoint."""

    def setUp(self):
        super().setUp()
        self.teacher_no_profile = User.objects.create_user(
            email="t2@qr.test.local", password="Passw0rd!", role=Role.TEACHER
        )
        self.outside_section = Section.objects.create(
            semester=self.section.semester, name="Outside", capacity=5
        )
        self.outside_student_user = User.objects.create_user(
            email="outside.qr@test.local", password="Passw0rd!", role=Role.STUDENT
        )
        self.outside_student = Student.objects.create(
            student_id="std-out-qr",
            roll_no="777",
            name="Outside Student",
            email=self.outside_student_user.email,
            section=self.outside_section,
            semester=self.section.semester,
        )
        self.outside_student_user.student_profile = self.outside_student
        self.outside_student_user.save(update_fields=["student_profile"])

    def _start(self):
        session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session.sections.add(self.section)
        self.client.force_authenticate(user=self.teacher_user)
        start = self.client.post(
            "/api/attendance/qr/start/",
            {"attendanceSessionId": session.pk},
            format="json",
        )
        self.assertEqual(start.status_code, 200)
        return session, start.data

    def _check_in(self, payload, user=None):
        self.client.force_authenticate(user=user or self.student_user)
        return self.client.post(
            "/api/attendance/qr/check-in/",
            {
                "qrPayload": payload,
                "network": {"method": "unavailable"},
            },
            format="json",
        )

    def test_generated_token_uses_secure_alphabet(self):
        for _ in range(50):
            token = generate_token()
            self.assertRegex(token, r"^[A-Z2-9]{4}-[A-Z2-9]{4}$")

    def test_check_in_requires_authentication(self):
        _, data = self._start()
        self.client.force_authenticate(user=None)
        resp = self.client.post(
            "/api/attendance/qr/check-in/",
            {"qrPayload": data["payload"]},
            format="json",
        )
        self.assertEqual(resp.status_code, 401)

    def test_check_in_rejects_a_non_student(self):
        _, data = self._start()
        resp = self._check_in(data["payload"], user=self.teacher_no_profile)
        self.assertEqual(resp.status_code, 403)

    def test_check_in_without_student_profile_rejected(self):
        _, data = self._start()
        no_profile = User.objects.create_user(
            email="np@qr.test.local", password="Passw0rd!", role=Role.STUDENT
        )
        resp = self._check_in(data["payload"], user=no_profile)
        self.assertEqual(resp.status_code, 403)

    def test_check_in_records_present_attendance(self):
        session, data = self._start()
        resp = self._check_in(data["payload"])
        self.assertEqual(resp.status_code, 201)
        body = resp.json()
        self.assertFalse(body["alreadyRecorded"])
        self.assertEqual(body["status"], "present")
        record = AttendanceRecord.objects.get(
            student=self.student, attendance_session=session
        )
        self.assertEqual(record.status, AttendanceStatus.PRESENT)
        self.assertIsNotNone(record.checked_in_at)
        self.assertEqual(record.network_verification_method, "unavailable")

    def test_check_in_rejects_malformed_payloads(self):
        self._start()
        for bad in ["", "AAMSQR0|5|ABC", "AAMSQR1", "AAMSQR1|5", "AAMSQR1|x|TOKEN", None, 123]:
            resp = self._check_in(bad)
            self.assertEqual(resp.status_code, 400, msg=f"payload={bad!r}")

    def test_check_in_unknown_session_id_is_generic(self):
        self._start()
        resp = self._check_in("AAMSQR1|999999|XXXX-XXXX")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["detail"], "This QR code is no longer active.")

    def test_check_in_wrong_token_rejected(self):
        session, data = self._start()
        resp = self._check_in(f"AAMSQR1|{session.pk}|AAAA-AAAA")
        self.assertEqual(resp.status_code, 400)

    def test_check_in_expired_token_rotates_and_rejects_stale(self):
        _, data = self._start()
        qr = QRAttendanceSession.objects.get(pk=data["id"])
        original = qr.token
        qr.token_generated_at = timezone.now() - timedelta(seconds=300)
        qr.save(update_fields=["token_generated_at"])
        resp = self._check_in(f"AAMSQR1|{qr.attendance_session_id}|{original}")
        self.assertEqual(resp.status_code, 400)
        qr.refresh_from_db()
        self.assertNotEqual(qr.token, original)

    def test_check_in_token_is_bound_to_its_session(self):
        _, data = self._start()
        other = AttendanceSession.objects.create(
            session_date=date(2026, 9, 8),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        other.sections.add(self.section)
        resp = self._check_in(f"AAMSQR1|{other.pk}|{data['token']}")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            AttendanceRecord.objects.filter(attendance_session=other).count(), 0
        )

    def test_check_in_duplicate_is_idempotent_200(self):
        session, data = self._start()
        first = self._check_in(data["payload"])
        self.assertEqual(first.status_code, 201)
        replay = self._check_in(data["payload"])
        self.assertEqual(replay.status_code, 200)
        self.assertTrue(replay.json()["alreadyRecorded"])
        self.assertEqual(
            AttendanceRecord.objects.filter(
                student=self.student, attendance_session=session
            ).count(),
            1,
        )

    def test_check_in_invalid_token_after_record_does_not_leak(self):
        session, data = self._start()
        self._check_in(data["payload"])
        resp = self._check_in(f"AAMSQR1|{session.pk}|AAAA-AAAA")
        self.assertEqual(resp.status_code, 400)
        self.assertNotIn("already", resp.json()["detail"].lower())

    def test_check_in_shared_token_marks_each_student_once(self):
        session, data = self._start()
        self.assertEqual(self._check_in(data["payload"]).status_code, 201)
        other_user = User.objects.create_user(
            email="o2@qr.test.local", password="Passw0rd!", role=Role.STUDENT
        )
        other_user.student_profile = self.other_student
        other_user.save(update_fields=["student_profile"])
        self.assertEqual(
            self._check_in(data["payload"], user=other_user).status_code, 201
        )
        self.assertEqual(
            AttendanceRecord.objects.filter(attendance_session=session).count(), 2
        )
        self.assertEqual(
            self._check_in(data["payload"], user=other_user).status_code, 200
        )

    def test_check_in_outside_section_rejected(self):
        session, data = self._start()
        resp = self._check_in(data["payload"], user=self.outside_student_user)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(
            AttendanceRecord.objects.filter(attendance_session=session).count(), 0
        )

    def test_check_in_finalized_session_rejected(self):
        session, data = self._start()
        self.client.force_authenticate(user=self.teacher_user)
        submit = self.client.post(
            f"/api/attendance/sessions/{session.pk}/submit/", {}, format="json"
        )
        self.assertEqual(submit.status_code, 200)
        resp = self._check_in(data["payload"])
        self.assertEqual(resp.status_code, 400)

    def test_check_in_stopped_session_rejected(self):
        session, data = self._start()
        self.client.force_authenticate(user=self.teacher_user)
        stop = self.client.post(f"/api/attendance/qr/{data['id']}/stop/")
        self.assertEqual(stop.status_code, 200)
        resp = self._check_in(data["payload"])
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            AttendanceRecord.objects.filter(attendance_session=session).count(), 0
        )

    def test_check_in_completed_semester_rejected(self):
        completed = Semester.objects.create(
            code="OLD-QR",
            name="Old QR",
            academic_year="2024-2025",
            start_date=date(2024, 1, 8),
            end_date=date(2024, 5, 17),
            status=SemesterStatus.COMPLETED,
        )
        old_subject = Subject.objects.create(
            semester=completed, code="OLD1", name="Old Sub", type=SubjectType.LECTURE
        )
        session = AttendanceSession.objects.create(
            session_date=date(2024, 2, 1),
            subject=old_subject,
            teacher=self.teacher,
            phase=AttendancePhase.QR,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        session.sections.add(self.section)
        self.client.force_authenticate(user=self.teacher_user)
        start = self.client.post(
            "/api/attendance/qr/start/",
            {"attendanceSessionId": session.pk},
            format="json",
        )
        self.assertEqual(start.status_code, 200)
        resp = self._check_in(start.data["payload"])
        self.assertEqual(resp.status_code, 400)

    def test_check_in_rejects_unsupported_network_method(self):
        _, data = self._start()
        self.client.force_authenticate(user=self.student_user)
        resp = self.client.post(
            "/api/attendance/qr/check-in/",
            {
                "qrPayload": data["payload"],
                "network": {"method": "gps"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_check_in_client_claimed_bssid_is_rejected(self):
        session, data = self._start()
        self.client.force_authenticate(user=self.student_user)
        resp = self.client.post(
            "/api/attendance/qr/check-in/",
            {
                "qrPayload": data["payload"],
                "network": {"method": "bssid", "bssid": "AA-BB-CC-DD-EE-FF"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            resp.json().get("detail"), "Unsupported network verification method."
        )
        self.assertEqual(
            AttendanceRecord.objects.filter(attendance_session=session).count(), 0
        )

    def test_check_in_rejects_mobile_network_bridge_claim(self):
        session, data = self._start()
        self.client.force_authenticate(user=self.student_user)
        resp = self.client.post(
            "/api/attendance/qr/check-in/",
            {
                "qrPayload": data["payload"],
                "network": {"method": "mobile_network_bridge"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            AttendanceRecord.objects.filter(attendance_session=session).count(), 0
        )

    def test_network_policy_gate_blocks_unverified_web_checkin(self):
        session, data = self._start()
        self.client.force_authenticate(user=self.student_user)
        with override_settings(AAMS_QR_REQUIRE_NETWORK_VERIFICATION=True):
            resp = self.client.post(
                "/api/attendance/qr/check-in/",
                {
                    "qrPayload": data["payload"],
                    "network": {"method": "unavailable"},
                },
                format="json",
            )
            self.assertEqual(resp.status_code, 403)
            self.assertTrue(resp.json().get("networkVerificationRequired"))
            self.assertEqual(
                AttendanceRecord.objects.filter(attendance_session=session).count(), 0
            )

    def test_check_in_throttled_per_student(self):
        _, data = self._start()
        self.client.force_authenticate(user=self.student_user)
        with override_settings(AAMS_QR_CHECKIN_THROTTLE_RATE="1/min"):
            first = self.client.post(
                "/api/attendance/qr/check-in/",
                {"qrPayload": data["payload"]},
                format="json",
            )
            self.assertEqual(first.status_code, 201)
            second = self.client.post(
                "/api/attendance/qr/check-in/",
                {"qrPayload": data["payload"]},
                format="json",
            )
            self.assertEqual(second.status_code, 429)

    def test_validate_is_student_only(self):
        _, data = self._start()
        self.client.force_authenticate(user=self.teacher_user)
        resp = self.client.post(
            f"/api/attendance/qr/{data['id']}/validate/",
            {"code": data["token"]},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)


class StudentMyAttendanceTests(AttendanceBase):
    def setUp(self):
        super().setUp()
        self.session = AttendanceSession.objects.create(
            session_date=date(2026, 9, 7),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(11, 0),
            planned_end_time=time(12, 0),
        )
        self.session.sections.add(self.section)
        mark_qr_student(self.session, self.student, AttendanceStatus.PRESENT.value)

    def test_my_returns_student_summary(self):
        self.client.force_authenticate(user=self.student_user)
        response = self.client.get("/api/attendance/records/my/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["overallTotal"], 1)
        self.assertEqual(response.data["overallPresent"], 1)
        self.assertEqual(response.data["overallPercentage"], 100.0)
        self.assertEqual(len(response.data["subjects"]), 1)
        self.assertEqual(response.data["subjects"][0]["subjectCode"], self.subject.code)
        self.assertEqual(len(response.data["logs"]), 1)
        self.assertEqual(response.data["logs"][0]["status"], "present")

    def test_my_is_scoped_to_authenticated_student(self):
        mark_qr_student(self.session, self.other_student, AttendanceStatus.ABSENT.value)
        self.client.force_authenticate(user=self.student_user)
        response = self.client.get("/api/attendance/records/my/")
        self.assertEqual(response.status_code, 200)
        # Only the caller's record is counted, never the other student's.
        self.assertEqual(response.data["overallTotal"], 1)
        self.assertEqual(response.data["overallPresent"], 1)

    def test_my_denied_for_non_student(self):
        self.client.force_authenticate(user=self.teacher_user)
        response = self.client.get("/api/attendance/records/my/")
        self.assertEqual(response.status_code, 403)

    def test_my_supports_subject_filter(self):
        self.client.force_authenticate(user=self.student_user)
        response = self.client.get(
            "/api/attendance/records/my/", {"subject": self.subject.pk}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["overallTotal"], 1)
        none = self.client.get(
            "/api/attendance/records/my/", {"subject": 999999}
        )
        self.assertEqual(none.status_code, 200)
        self.assertEqual(none.data["overallTotal"], 0)

    def test_my_reports_absent_late_and_exam_eligibility(self):
        session2 = AttendanceSession.objects.create(
            session_date=date(2026, 9, 8),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        session2.sections.add(self.section)
        session3 = AttendanceSession.objects.create(
            session_date=date(2026, 9, 9),
            subject=self.subject,
            teacher=self.teacher,
            phase=AttendancePhase.MANUAL,
            start_time=time(9, 0),
            planned_end_time=time(10, 0),
        )
        session3.sections.add(self.section)
        mark_qr_student(session2, self.student, AttendanceStatus.LATE.value)
        mark_qr_student(session3, self.student, AttendanceStatus.ABSENT.value)

        self.client.force_authenticate(user=self.student_user)
        response = self.client.get("/api/attendance/records/my/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totalClasses"], 3)
        self.assertEqual(response.data["totalPresent"], 2)
        self.assertEqual(response.data["totalAbsent"], 1)
        self.assertEqual(response.data["totalLate"], 1)
        self.assertEqual(response.data["overallAbsent"], 1)
        self.assertEqual(response.data["overallLate"], 1)
        self.assertEqual(response.data["overallPercentage"], 66.67)
        self.assertEqual(response.data["examEligibility"], "shortage")
        by_subject = {s["subjectId"]: s for s in response.data["subjects"]}[
            self.subject.pk
        ]
        self.assertEqual(by_subject["absent"], 1)
        self.assertEqual(by_subject["late"], 1)
        self.assertEqual(by_subject["present"], 2)
        self.assertEqual(by_subject["total"], 3)
