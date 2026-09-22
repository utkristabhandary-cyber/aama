import io
from datetime import date, time, timedelta

import openpyxl

from django.contrib.auth import get_user_model
from django.utils import timezone

from rest_framework.test import APITestCase

from apps.academics.models import (
    Holiday,
    HolidayType,
    Semester,
    SemesterStatus,
    Section,
    Subject,
    SubjectType,
)
from apps.accounts.models import Role
from apps.teachers.models import Teacher

from .models import TimesheetEntry, TimesheetEntryStatus, TimesheetEntryType
from .views import TIMESHEET_EXPORT_HEADERS

User = get_user_model()


class TimesheetBase(APITestCase):
    def setUp(self):
        self.teacher_user = User.objects.create_user(
            email="teacher@ts.local", password="Passw0rd!", role=Role.TEACHER
        )
        self.teacher = Teacher.objects.create(
            teacher_id="tch-ts", name="Dr. Log", email=self.teacher_user.email
        )
        self.teacher_user.teacher_profile = self.teacher
        self.teacher_user.save(update_fields=["teacher_profile"])

        self.semester = Semester.objects.create(
            code="SEM-TS",
            name="Timesheet Semester",
            academic_year="2026-2027",
            start_date=date(2026, 3, 1),
            end_date=date(2026, 7, 31),
            status=SemesterStatus.ACTIVE,
        )
        self.section = Section.objects.create(semester=self.semester, name="A", capacity=5)
        self.subject = Subject.objects.create(
            semester=self.semester,
            code="TS1",
            name="Timesheet Subject",
            type=SubjectType.LECTURE,
        )
        self.admin = User.objects.create_user(
            email="admin@ts.local", password="Passw0rd!", role=Role.ADMIN
        )

    def _as(self, user):
        self.client.force_authenticate(user=user)

    @staticmethod
    def _other_teacher(email="other@ts.local"):
        return Teacher.objects.create(
            teacher_id=f"tch-{email.split('@')[0]}", name="Other", email=email
        )

    @staticmethod
    def _link_teacher(user, teacher):
        user.teacher_profile = teacher
        user.save(update_fields=["teacher_profile"])

    def _class_payload(self, **overrides):
        payload = {
            "entry_date": "2026-09-07",
            "type": TimesheetEntryType.CLASS,
            "subject": self.subject.pk,
            "section_ids": [self.section.pk],
            "start_time": "09:00",
            "end_time": "11:30",
            "note": "Lecture",
        }
        payload.update(overrides)
        return payload


class TimesheetApiAuthTests(TimesheetBase):
    """HTTP-level authorization and input rules."""

    def test_anonymous_cannot_list_entries(self):
        response = self.client.get("/api/timesheet/entries/")
        self.assertEqual(response.status_code, 401)

    def test_student_cannot_access_entries(self):
        student_user = User.objects.create_user(
            email="student@ts.local", password="Passw0rd!", role=Role.STUDENT
        )
        self._as(student_user)
        response = self.client.get("/api/timesheet/entries/")
        self.assertEqual(response.status_code, 403)

    def test_teacher_creates_own_class_entry(self):
        self._as(self.teacher_user)
        response = self.client.post(
            "/api/timesheet/entries/", self._class_payload(), format="json"
        )
        self.assertEqual(response.status_code, 201)
        entry = TimesheetEntry.objects.get(pk=response.data["id"])
        self.assertEqual(entry.teacher, self.teacher)
        self.assertEqual(entry.created_by, self.teacher_user)
        self.assertEqual(entry.status, TimesheetEntryStatus.DRAFT)
        self.assertEqual(entry.semester, self.semester)
        self.assertEqual(response.data["duration_minutes"], 150)
        self.assertEqual(response.data["teacher_name"], self.teacher.name)
        self.assertEqual(response.data["subject_code"], self.subject.code)
        self.assertEqual(response.data["section_names"], ["A"])

    def test_teacher_cannot_assign_another_teacher(self):
        other_teacher = self._other_teacher()
        self._as(self.teacher_user)
        payload = self._class_payload()
        payload["teacher"] = other_teacher.pk
        response = self.client.post(
            "/api/timesheet/entries/", payload, format="json"
        )
        self.assertEqual(response.status_code, 201)
        entry = TimesheetEntry.objects.get(pk=response.data["id"])
        self.assertEqual(entry.teacher, self.teacher)

    def test_teacher_sees_only_own_entries(self):
        other_teacher = self._other_teacher()
        other_user = User.objects.create_user(
            email=other_teacher.email, password="Passw0rd!", role=Role.TEACHER
        )
        self._link_teacher(other_user, other_teacher)
        other_entry = TimesheetEntry.objects.create(
            teacher=other_teacher,
            entry_date=date(2026, 9, 7),
            type=TimesheetEntryType.DUTY,
            start_time=time(8, 0),
            end_time=time(9, 0),
        )
        self._as(self.teacher_user)
        own = self.client.post(
            "/api/timesheet/entries/", self._class_payload(), format="json"
        )
        self.assertEqual(own.status_code, 201)
        response = self.client.get("/api/timesheet/entries/")
        ids = [row["id"] for row in response.data["results"]]
        self.assertNotIn(other_entry.pk, ids)
        self.assertEqual(len(ids), 1)
        detail = self.client.get(f"/api/timesheet/entries/{other_entry.pk}/")
        self.assertEqual(detail.status_code, 404)

    def test_admin_create_requires_teacher(self):
        self._as(self.admin)
        payload = self._class_payload()
        payload.pop("teacher", None)
        response = self.client.post(
            "/api/timesheet/entries/", payload, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_admin_create_for_teacher(self):
        self._as(self.admin)
        payload = self._class_payload()
        payload["teacher"] = self.teacher.pk
        response = self.client.post(
            "/api/timesheet/entries/", payload, format="json"
        )
        self.assertEqual(response.status_code, 201)
        entry = TimesheetEntry.objects.get(pk=response.data["id"])
        self.assertEqual(entry.teacher, self.teacher)

    def test_class_entry_requires_subject_and_sections(self):
        self._as(self.teacher_user)
        no_subject = self._class_payload()
        no_subject.pop("subject")
        self.assertEqual(
            self.client.post(
                "/api/timesheet/entries/", no_subject, format="json"
            ).status_code,
            400,
        )
        no_sections = self._class_payload()
        no_sections.pop("section_ids")
        self.assertEqual(
            self.client.post(
                "/api/timesheet/entries/", no_sections, format="json"
            ).status_code,
            400,
        )

    def test_class_entry_sections_must_match_subject_semester(self):
        other_semester = Semester.objects.create(
            code="SEM-OTHER",
            name="Other",
            academic_year="2025-2026",
            start_date=date(2025, 1, 1),
            end_date=date(2025, 5, 30),
            status=SemesterStatus.ACTIVE,
        )
        foreign_section = Section.objects.create(
            semester=other_semester, name="B", capacity=5
        )
        self._as(self.teacher_user)
        payload = self._class_payload()
        payload["section_ids"] = [foreign_section.pk]
        response = self.client.post(
            "/api/timesheet/entries/", payload, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_duty_entry_forbids_subject_and_sections(self):
        self._as(self.teacher_user)
        with_subject = {
            "entry_date": "2026-09-07",
            "type": TimesheetEntryType.DUTY,
            "subject": self.subject.pk,
            "start_time": "08:00",
            "end_time": "09:00",
        }
        self.assertEqual(
            self.client.post(
                "/api/timesheet/entries/", with_subject, format="json"
            ).status_code,
            400,
        )
        with_sections = {
            "entry_date": "2026-09-07",
            "type": TimesheetEntryType.DUTY,
            "section_ids": [self.section.pk],
            "start_time": "08:00",
            "end_time": "09:00",
        }
        self.assertEqual(
            self.client.post(
                "/api/timesheet/entries/", with_sections, format="json"
            ).status_code,
            400,
        )
        duty = {
            "entry_date": "2026-09-07",
            "type": TimesheetEntryType.DUTY,
            "start_time": "08:00",
            "end_time": "09:00",
            "note": "Assembly duty",
        }
        self.assertEqual(
            self.client.post("/api/timesheet/entries/", duty, format="json").status_code,
            201,
        )

    def test_future_entry_date_rejected(self):
        self._as(self.teacher_user)
        payload = self._class_payload()
        tomorrow = timezone.localdate() + timedelta(days=1)
        payload["entry_date"] = tomorrow.isoformat()
        self.assertEqual(
            self.client.post(
                "/api/timesheet/entries/", payload, format="json"
            ).status_code,
            400,
        )

    def test_end_time_must_be_after_start_time(self):
        self._as(self.teacher_user)
        payload = self._class_payload()
        payload["end_time"] = "09:00"
        self.assertEqual(
            self.client.post(
                "/api/timesheet/entries/", payload, format="json"
            ).status_code,
            400,
        )

    def test_overlapping_entry_rejected(self):
        self._as(self.teacher_user)
        first = self.client.post(
            "/api/timesheet/entries/", self._class_payload(), format="json"
        )
        self.assertEqual(first.status_code, 201)
        overlap = self._class_payload()
        overlap["start_time"] = "09:30"
        overlap["end_time"] = "10:30"
        response = self.client.post(
            "/api/timesheet/entries/", overlap, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            TimesheetEntry.objects.filter(teacher=self.teacher).count(), 1
        )

    def test_adjacent_entry_allowed(self):
        self._as(self.teacher_user)
        first = self.client.post(
            "/api/timesheet/entries/", self._class_payload(), format="json"
        )
        self.assertEqual(first.status_code, 201)
        adjacent = self._class_payload()
        adjacent["start_time"] = "11:30"
        adjacent["end_time"] = "12:30"
        self.assertEqual(
            self.client.post(
                "/api/timesheet/entries/", adjacent, format="json"
            ).status_code,
            201,
        )

    def test_holiday_surfaced_not_blocked(self):
        Holiday.objects.create(
            date=date(2026, 9, 7),
            title="National Holiday",
            type=HolidayType.NATIONAL,
        )
        self._as(self.teacher_user)
        response = self.client.post(
            "/api/timesheet/entries/", self._class_payload(), format="json"
        )
        self.assertEqual(response.status_code, 201)
        detail = self.client.get(
            f"/api/timesheet/entries/{response.data['id']}/"
        )
        self.assertEqual(detail.status_code, 200)
        self.assertTrue(detail.data["is_holiday"])
        self.assertEqual(detail.data["holiday_title"], "National Holiday")


class TimesheetWorkflowLifecycleTests(TimesheetBase):
    """DRAFT -> SUBMITTED -> CONFIRMED/REJECTED state machine."""

    def _create_and_submit(self):
        self._as(self.teacher_user)
        created = self.client.post(
            "/api/timesheet/entries/", self._class_payload(), format="json"
        )
        self.assertEqual(created.status_code, 201)
        entry_id = created.data["id"]
        submitted = self.client.post(
            f"/api/timesheet/entries/{entry_id}/submit/", {}, format="json"
        )
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.data["status"], TimesheetEntryStatus.SUBMITTED)
        return entry_id

    def test_full_confirm_workflow(self):
        entry_id = self._create_and_submit()
        self._as(self.admin)
        confirmed = self.client.post(
            f"/api/timesheet/entries/{entry_id}/confirm/", {}, format="json"
        )
        self.assertEqual(confirmed.status_code, 200)
        entry = TimesheetEntry.objects.get(pk=entry_id)
        self.assertEqual(entry.status, TimesheetEntryStatus.CONFIRMED)
        # CONFIRMED is immutable.
        self._as(self.teacher_user)
        patch = self.client.patch(
            f"/api/timesheet/entries/{entry_id}/",
            {"note": "changed"},
            format="json",
        )
        self.assertEqual(patch.status_code, 403)
        delete = self.client.delete(f"/api/timesheet/entries/{entry_id}/")
        self.assertEqual(delete.status_code, 403)

    def test_reject_requires_reason(self):
        entry_id = self._create_and_submit()
        self._as(self.admin)
        no_reason = self.client.post(
            f"/api/timesheet/entries/{entry_id}/reject/", {}, format="json"
        )
        self.assertEqual(no_reason.status_code, 400)
        rejected = self.client.post(
            f"/api/timesheet/entries/{entry_id}/reject/",
            {"rejectionReason": "Schedule mismatch"},
            format="json",
        )
        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(rejected.data["status"], TimesheetEntryStatus.REJECTED)
        self.assertEqual(rejected.data["rejection_reason"], "Schedule mismatch")

    def test_owner_edit_of_rejected_entry_resets_to_draft(self):
        entry_id = self._create_and_submit()
        self._as(self.admin)
        self.client.post(
            f"/api/timesheet/entries/{entry_id}/reject/",
            {"rejectionReason": "Wrong slot"},
            format="json",
        )
        self._as(self.teacher_user)
        edited = self.client.patch(
            f"/api/timesheet/entries/{entry_id}/",
            {"start_time": "10:00", "end_time": "11:30"},
            format="json",
        )
        self.assertEqual(edited.status_code, 200)
        entry = TimesheetEntry.objects.get(pk=entry_id)
        self.assertEqual(entry.status, TimesheetEntryStatus.DRAFT)
        self.assertEqual(entry.rejection_reason, "")

    def test_recall_returns_submitted_to_draft(self):
        entry_id = self._create_and_submit()
        self._as(self.teacher_user)
        recalled = self.client.post(
            f"/api/timesheet/entries/{entry_id}/recall/", {}, format="json"
        )
        self.assertEqual(recalled.status_code, 200)
        self.assertEqual(recalled.data["status"], TimesheetEntryStatus.DRAFT)

    def test_submitted_entry_not_editable_by_owner(self):
        entry_id = self._create_and_submit()
        self._as(self.teacher_user)
        patch = self.client.patch(
            f"/api/timesheet/entries/{entry_id}/",
            {"note": "urgent"},
            format="json",
        )
        self.assertEqual(patch.status_code, 403)

    def test_admin_can_edit_submitted_entry(self):
        entry_id = self._create_and_submit()
        self._as(self.admin)
        patch = self.client.patch(
            f"/api/timesheet/entries/{entry_id}/",
            {"note": "corrected by admin"},
            format="json",
        )
        self.assertEqual(patch.status_code, 200)

    def test_teacher_cannot_confirm_own_entry(self):
        entry_id = self._create_and_submit()
        confirm = self.client.post(
            f"/api/timesheet/entries/{entry_id}/confirm/", {}, format="json"
        )
        self.assertEqual(confirm.status_code, 403)

    def test_submit_only_from_draft_or_rejected(self):
        entry_id = self._create_and_submit()
        self._as(self.teacher_user)
        again = self.client.post(
            f"/api/timesheet/entries/{entry_id}/submit/", {}, format="json"
        )
        self.assertEqual(again.status_code, 400)

    def test_rejected_entry_does_not_block_overlapping_work(self):
        entry_id = self._create_and_submit()
        self._as(self.admin)
        self.client.post(
            f"/api/timesheet/entries/{entry_id}/reject/",
            {"rejectionReason": "Duplicate"},
            format="json",
        )
        self._as(self.teacher_user)
        overlap = self._class_payload()
        overlap["start_time"] = "09:30"
        overlap["end_time"] = "10:30"
        self.assertEqual(
            self.client.post(
                "/api/timesheet/entries/", overlap, format="json"
            ).status_code,
            201,
        )


class TimesheetSummaryExportTests(TimesheetBase):
    """Only CONFIRMED entries count toward the ledger and the admin export."""

    def _create_entry(self, status_value, **overrides):
        entry = TimesheetEntry.objects.create(
            teacher=self.teacher,
            entry_date=overrides.get("entry_date", date(2026, 9, 7)),
            type=TimesheetEntryType.CLASS,
            subject=self.subject,
            semester=self.semester,
            start_time=overrides.get("start_time", time(9, 0)),
            end_time=overrides.get("end_time", time(10, 0)),
            status=status_value,
        )
        entry.sections.add(self.section)
        return entry

    def test_summary_counts_only_confirmed(self):
        draft = self._create_entry(TimesheetEntryStatus.DRAFT)
        submitted = self._create_entry(
            TimesheetEntryStatus.SUBMITTED, start_time=time(10, 0), end_time=time(11, 0)
        )
        rejected = self._create_entry(
            TimesheetEntryStatus.REJECTED, start_time=time(11, 0), end_time=time(12, 0)
        )
        confirmed = self._create_entry(
            TimesheetEntryStatus.CONFIRMED, start_time=time(12, 0), end_time=time(13, 0)
        )
        self._as(self.teacher_user)
        response = self.client.get("/api/timesheet/summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["duration_minutes"], 60)
        self.assertEqual(response.data["by_type"]["class"], 60)
        self.assertEqual(len(response.data["per_teacher"]), 1)

    def test_summary_teacher_scoped_to_own_confirmed(self):
        other_teacher = self._other_teacher()
        other = TimesheetEntry.objects.create(
            teacher=other_teacher,
            entry_date=date(2026, 9, 7),
            type=TimesheetEntryType.DUTY,
            start_time=time(8, 0),
            end_time=time(9, 0),
            status=TimesheetEntryStatus.CONFIRMED,
        )
        self._as(self.teacher_user)
        response = self.client.get("/api/timesheet/summary/")
        self.assertEqual(response.data["count"], 0)
        self.assertEqual(response.data["per_teacher"], [])

    def test_admin_summary_aggregates_across_teachers(self):
        other_teacher = self._other_teacher()
        TimesheetEntry.objects.create(
            teacher=other_teacher,
            entry_date=date(2026, 9, 7),
            type=TimesheetEntryType.DUTY,
            start_time=time(8, 0),
            end_time=time(9, 0),
            status=TimesheetEntryStatus.CONFIRMED,
        )
        self._create_entry(TimesheetEntryStatus.CONFIRMED)
        self._as(self.admin)
        response = self.client.get("/api/timesheet/summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(response.data["duration_minutes"], 120)
        self.assertEqual(len(response.data["per_teacher"]), 2)

    def test_export_is_admin_only(self):
        self._as(self.teacher_user)
        response = self.client.get("/api/timesheet/export/")
        self.assertEqual(response.status_code, 403)
        self._as(self.admin)
        response = self.client.get("/api/timesheet/export/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(
            "spreadsheetml",
            response["Content-Type"],
        )
        self.assertIn("attachment", response["Content-Disposition"])

    def test_export_contains_only_confirmed_rows(self):
        self._create_entry(TimesheetEntryStatus.CONFIRMED)
        self._create_entry(
            TimesheetEntryStatus.DRAFT, start_time=time(14, 0), end_time=time(15, 0)
        )
        self._as(self.admin)
        response = self.client.get("/api/timesheet/export/")
        workbook = openpyxl.load_workbook(io.BytesIO(response.content))
        rows = list(workbook["Timesheet"].iter_rows(values_only=True))
        self.assertEqual(rows[0], tuple(TIMESHEET_EXPORT_HEADERS))
        data_rows = rows[1:]
        # A single data row: only the confirmed entry is exported.
        self.assertEqual(len(data_rows), 1)
        self.assertEqual(data_rows[0][0], self.teacher.teacher_id)
        self.assertEqual(data_rows[0][2], "2026-09-07")

    def test_filter_by_date_range(self):
        self._create_entry(TimesheetEntryStatus.CONFIRMED)
        self._create_entry(
            TimesheetEntryStatus.CONFIRMED,
            entry_date=date(2026, 4, 10),
            start_time=time(14, 0),
            end_time=time(15, 0),
        )
        self._as(self.admin)
        response = self.client.get(
            "/api/timesheet/summary/",
            {"date_from": "2026-04-01", "date_to": "2026-04-30"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["by_day"][0]["entry_date"], "2026-04-10")