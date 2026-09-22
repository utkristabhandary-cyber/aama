"""Import confirm-view error handling (Phase K hardening).

The generic import confirm commit must never surface a raw 500 to the admin on
a mid-batch error: what the timetable import already does (blanket rollback ->
controlled 400) is enforced here too.
"""
from unittest import mock

from django.contrib.auth import get_user_model

from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.imports.models import ImportSession

User = get_user_model()


class ImportConfirmErrorHandlingTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="imp-admin@local", password="Passw0rd!", role=Role.ADMIN
        )
        self.client.force_authenticate(user=self.admin)
        self.session = ImportSession.objects.create(
            kind="students",
            created_by=self.admin,
            file_name="roster.xlsx",
            file_size=1024,
            status=ImportSession.Status.PENDING,
        )

    @mock.patch("apps.imports.student_import.execute_student_confirm")
    def test_unexpected_commit_error_returns_400_and_keeps_session_pending(
        self, executor
    ):
        executor.side_effect = RuntimeError("boom")
        response = self.client.post(
            "/api/imports/students/confirm/",
            {"session_uuid": str(self.session.uuid)},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "import_failed")
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, ImportSession.Status.PENDING)