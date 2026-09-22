"""Concurrency: two simultaneous confirm requests for the same timetable
session must serialize on the session row. Exactly one confirm may commit;
the loser returns HTTP 400 with code ``already_confirmed``.

This uses TransactionTestCase (real commits) so that ``select_for_update``
row locks genuinely contend across threads.
"""
import io
import threading
from datetime import date, time

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from apps.academics.models import (
    DayOfWeek,
    Section,
    Semester,
    SemesterStatus,
    Subject,
    SubjectType,
    TimetableSlot,
)
from apps.accounts.models import Role
from apps.teachers.models import Teacher


def _xlsx_bytes(rows, title="Sheet1"):
    import openpyxl

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = title
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer


class TimetableConfirmConcurrencyTests(TransactionTestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            email="admin@test.local", password="Passw0rd!", role=Role.ADMIN
        )
        self.semester = Semester.objects.create(
            code="SEM-T1",
            name="Test Semester",
            academic_year="2025-2026",
            start_date=date(2026, 1, 12),
            end_date=date(2026, 5, 22),
            status=SemesterStatus.ACTIVE,
        )
        self.section = Section.objects.create(
            semester=self.semester, name="A", capacity=5
        )
        self.subject = Subject.objects.create(
            semester=self.semester, code="T1", name="Subject 1", type=SubjectType.LECTURE
        )
        self.teacher = Teacher.objects.create(
            teacher_id="tch-test-1",
            name="Dr. Test",
            email="dr.test@aams.local",
        )
        from apps.accounts.models import ExpiringToken

        self.token = "Token " + ExpiringToken.issue_for(self.admin).key

    def upload_preview(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=self.token)
        headers = [
            "Semester", "Section", "Day", "Module Code", "Module Title",
            "Lecturer", "Start Time", "End Time", "Classroom", "Class Type",
        ]
        rows = [["SEM-T1", "A", "Monday", "T1", "Subject 1", "Dr. Test",
                 "09:00", "10:00", "R-101", "Lecture"]]
        content = SimpleUploadedFile("timetable.xlsx", _xlsx_bytes([headers] + rows).read())
        response = client.post(
            "/api/academics/timetable-import/preview/",
            {"file": content},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["session_uuid"]

    def confirm_worker(self, session_uuid, barrier, results, index):
        try:
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=self.token)
            barrier.wait(timeout=30)
            response = client.post(
                "/api/academics/timetable-import/confirm/",
                {"session_uuid": session_uuid},
                format="json",
            )
            results[index].append(response.status_code)
            results[index].append(response.data.get("code"))
        except Exception as exc:  # pragma: no cover - test harness path
            results[index].append("EXCEPTION")
            results[index].append(str(exc))
        finally:
            from django.db import connections

            connections.close_all()

    def test_concurrent_confirms_create_one_slot(self):
        session_uuid = self.upload_preview()

        barrier = threading.Barrier(2)
        results = {0: [], 1: []}
        threads = [
            threading.Thread(
                target=self.confirm_worker, args=(session_uuid, barrier, results, i)
            )
            for i in range(2)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        responses = [tuple(r) for r in results.values()]
        statuses = sorted(r[0] for r in responses)
        self.assertEqual(statuses, [200, 400])
        codes = sorted((r[1] or "ok") for r in responses)
        self.assertEqual(codes, ["already_confirmed", "ok"])
        self.assertEqual(
            TimetableSlot.objects.filter(section=self.section).count(), 1
        )
        slot = TimetableSlot.objects.get(semester=self.semester, section=self.section)
        self.assertEqual(slot.day, DayOfWeek.MONDAY)
        self.assertEqual(slot.start_time, time(9, 0))
        self.assertEqual(slot.end_time, time(10, 0))