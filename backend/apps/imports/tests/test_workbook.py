"""FILE-level gating tests (size, type, readability, row limits)."""
from django.test import SimpleTestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status

from apps.academics.timetable_import import ImportFileError
from apps.imports.engine.constants import (
    MAX_CELL_CHARS,
    MAX_DATA_ROWS,
    MAX_FILE_BYTES,
)
from apps.imports.engine.workbook import validate_file
from apps.imports.tests.helpers import ImportsBase, xlsx_bytes, xlsx_file


class FileEngineTests(SimpleTestCase):
    def test_accepts_xlsx(self):
        file_obj = xlsx_file("ok.xlsx", [["ID", "Name"]])
        validate_file(file_obj, "ok.xlsx")

    def test_legacy_xls_rejected_with_guidance(self):
        with self.assertRaises(ImportFileError) as ctx:
            validate_file(SimpleUploadedFile("old.xls", b"x"), "old.xls")
        self.assertEqual(ctx.exception.code, "file_not_xlsx")
        self.assertIn("Legacy", ctx.exception.message)

    def test_macro_xlsm_rejected(self):
        with self.assertRaises(ImportFileError) as ctx:
            validate_file(SimpleUploadedFile("m.xlsm", b"x"), "m.xlsm")
        self.assertEqual(ctx.exception.code, "file_not_xlsx")
        self.assertIn("macro", ctx.exception.message.lower())

    def test_other_extensions_rejected(self):
        with self.assertRaises(ImportFileError) as ctx:
            validate_file(SimpleUploadedFile("data.csv", b"x"), "data.csv")
        self.assertEqual(ctx.exception.code, "file_not_xlsx")

    def test_oversized_file_rejected(self):
        big = SimpleUploadedFile("big.xlsx", b"\x00" * (MAX_FILE_BYTES + 1))
        with self.assertRaises(ImportFileError) as ctx:
            validate_file(big, "big.xlsx")
        self.assertEqual(ctx.exception.code, "file_too_large")
        self.assertIn("5 MB", ctx.exception.message)

    def test_corrupt_workbook_rejected(self):
        from apps.imports.engine.workbook import read_worksheet

        bad = SimpleUploadedFile("bad.xlsx", b"not-a-real-workbook")
        with self.assertRaises(ImportFileError) as ctx:
            read_worksheet(bad, "bad.xlsx")
        self.assertEqual(ctx.exception.code, "file_corrupt")

    def test_blank_workbook_rejected(self):
        from apps.imports.engine.plan import prepare_import_preview

        with self.assertRaises(ImportFileError) as ctx:
            prepare_import_preview(xlsx_file("blank.xlsx", []), "blank.xlsx", kind="students")
        self.assertEqual(ctx.exception.code, "file_empty_worksheet")


class FilePreviewApiTests(ImportsBase):
    PREVIEW_URL = "/api/imports/teachers/preview/"
    LIST_URL = "/api/imports/teachers/"

    def test_missing_file_field_rejected(self):
        response = self.client.post(self.PREVIEW_URL, {}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "file_required")

    def test_legacy_xls_rejected_at_api(self):
        response = self.client.post(
            self.PREVIEW_URL,
            {"file": SimpleUploadedFile("old.xls", b"x")},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "file_not_xlsx")

    def test_oversized_rejected_at_api(self):
        response = self.client.post(
            self.PREVIEW_URL,
            {"file": SimpleUploadedFile("big.xlsx", b"\x00" * (MAX_FILE_BYTES + 1))},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["code"], "file_too_large")

    def test_too_many_data_rows_rejected(self):
        from apps.imports.engine.plan import prepare_import_preview

        rows = [["ID", "Name"]] + [[str(i), f"name-{i}"] for i in range(MAX_DATA_ROWS + 1)]
        with self.assertRaises(ImportFileError) as ctx:
            prepare_import_preview(xlsx_file("many.xlsx", rows), "many.xlsx", kind="students")
        self.assertEqual(ctx.exception.code, "file_too_many_rows")
        self.assertIn(str(MAX_DATA_ROWS), ctx.exception.message)

    def test_headers_only_file_rejected_as_no_data(self):
        from apps.imports.engine.plan import prepare_import_preview

        with self.assertRaises(ImportFileError) as ctx:
            prepare_import_preview(
                xlsx_file("noro.xlsx", [["ID", "Name"]]), "noro.xlsx", kind="students"
            )
        self.assertEqual(ctx.exception.code, "no_data_rows")

    def test_overlong_cell_truncated_for_review(self):
        long_name = "A" * (2 * MAX_CELL_CHARS + 50)
        response = self._preview([["S1", long_name, "a@b.com"]])
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data["rows"][0]
        self.assertEqual(row["severity"], "suspicious")
        self.assertIn("cell_truncated", [i["code"] for i in row["issues"]])
        self.assertEqual(len(row["normalized"]["1"]), MAX_CELL_CHARS)
        self.assertIn("…", row["cells"]["1"])