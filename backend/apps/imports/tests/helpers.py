"""Shared helpers for the institutional import test-suite."""
import io

import openpyxl
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from apps.accounts.models import Role


def xlsx_bytes(rows, title="Sheet1"):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = title
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


def xlsx_file(name, rows, title="Sheet1"):
    return SimpleUploadedFile(name, xlsx_bytes(rows, title))


class ImportsBase(APITestCase):
    PREVIEW_URL = "/api/imports/students/preview/"
    LIST_URL = "/api/imports/students/"

    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            email="admin@test.local", password="Passw0rd!", role=Role.ADMIN
        )
        self.other_admin = User.objects.create_user(
            email="admin2@test.local", password="Passw0rd!", role=Role.ADMIN
        )
        self.teacher = User.objects.create_user(
            email="teacher@test.local", password="Passw0rd!", role=Role.TEACHER
        )
        self.student = User.objects.create_user(
            email="student@test.local", password="Passw0rd!", role=Role.STUDENT
        )
        self.auth_admin()

    # -- auth helpers -----------------------------------------------------
    def _token(self, user):
        from apps.accounts.models import ExpiringToken

        return "Token " + ExpiringToken.issue_for(user).key

    def auth_admin(self):
        self.client.credentials(HTTP_AUTHORIZATION=self._token(self.admin))

    def auth_as(self, user):
        self.client.credentials(HTTP_AUTHORIZATION=self._token(user))

    def clear_auth(self):
        self.client.credentials()

    # -- request helpers --------------------------------------------------
    def _preview(self, rows, name="students.xlsx", headers=None, title="Sheet1", url=None):
        header = headers if headers is not None else ["ID", "Name", "Email", "Phone"]
        payload = xlsx_file(name, [header] + rows, title)
        return self.client.post(
            url or self.PREVIEW_URL,
            {"file": payload},
            format="multipart",
        )