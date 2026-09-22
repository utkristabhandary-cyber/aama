"""SECURITY tests: auth, role gating, session ownership, unknown kinds."""
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status

from apps.accounts.models import Role
from apps.imports.models import ImportSession
from apps.imports.tests.helpers import ImportsBase


class ExceptionHandlerUnitTests(ImportsBase):
    """Global exception handler must normalize Django ValidationError shapes
    to a 400 (Phase F regression: a flat-list ValidationError used to crash
    the handler with AttributeError -> 500)."""

    def test_flat_list_validation_error_yields_400(self):
        from config.exceptions import aams_exception_handler

        response = aams_exception_handler(
            DjangoValidationError(["This value is not valid."]), {}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["detail"], ["This value is not valid."])

    def test_dict_validation_error_yields_field_errors(self):
        from config.exceptions import aams_exception_handler

        response = aams_exception_handler(
            DjangoValidationError({"email": ["Enter a valid email address."]}), {}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data["detail"], {"email": ["Enter a valid email address."]}
        )


class ImportSecurityTests(ImportsBase):
    PREVIEW_URL = "/api/imports/teachers/preview/"
    LIST_URL = "/api/imports/teachers/"

    def test_unauthenticated_preview_rejected(self):
        self.clear_auth()
        response = self._preview([["S1", "Alice", "a@b.com"]])
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_teacher_rejected(self):
        self.auth_as(self.teacher)
        response = self._preview([["S1", "Alice", "a@b.com"]])
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_student_rejected(self):
        self.auth_as(self.student)
        response = self._preview([["S1", "Alice", "a@b.com"]])
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_preview_allowed(self):
        response = self._preview([["S1", "Alice", "a@b.com"]])
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_unauthenticated_list_rejected(self):
        self.clear_auth()
        response = self.client.get(self.LIST_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_teacher_list_rejected(self):
        self.auth_as(self.teacher)
        response = self.client.get(self.LIST_URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_student_list_rejected(self):
        self.auth_as(self.student)
        response = self.client.get(self.LIST_URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unknown_kind_preview_404(self):
        response = self.client.post(
            "/api/imports/classrooms/preview/",
            {"file": self._preview_bytes()},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data["code"], "kind_unknown")

    def test_unknown_kind_list_404(self):
        response = self.client.get("/api/imports/classrooms/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def _preview_bytes(self):
        from apps.imports.tests.helpers import xlsx_file

        return xlsx_file("s.xlsx", [["ID", "Name"]])


class ImportSessionScopingTests(ImportsBase):
    PREVIEW_URL = "/api/imports/teachers/preview/"
    LIST_URL = "/api/imports/teachers/"

    def test_preview_creates_pending_session_for_admin(self):
        response = self._preview([["S1", "Alice", "a@b.com"]])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        session = ImportSession.objects.get(uuid=response.data["session_uuid"])
        self.assertEqual(session.created_by, self.admin)
        self.assertEqual(session.kind, "teachers")
        self.assertEqual(session.status, ImportSession.Status.PENDING)
        self.assertEqual(session.parsed_rows, response.data["rows"])
        self.assertEqual(session.summary, response.data["summary"])

    def test_list_scoped_to_importing_admin(self):
        self._preview([["S1", "Alice", "a@b.com"]])
        self.auth_as(self.other_admin)
        response = self.client.get(self.LIST_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, [])

    def test_list_returns_own_sessions_newest_first(self):
        self._preview([["S1", "Alice", "a@b.com"]], name="first.xlsx")
        self._preview([["S2", "Bob", "b@b.com"]], name="second.xlsx")
        response = self.client.get(self.LIST_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        self.assertIsNone(response.data[0]["confirmed_at"])
        self.assertEqual(response.data[0]["status"], "pending")
        self.assertEqual(response.data[0]["file_name"], "second.xlsx")

    def test_teacher_kind_session_listed_under_teacher_url(self):
        url = "/api/imports/teachers/preview/"
        response = self._preview([["TCH-1", "Prof. Ravi", "ravi@aams.local"]], name="teachers.xlsx", url=url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["kind"], "teachers")
        listing = self.client.get("/api/imports/teachers/")
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertEqual(len(listing.data), 1)
        self.assertEqual(listing.data[0]["kind"], "teachers")