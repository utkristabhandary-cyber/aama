"""HEADER-shape tests: blank, duplicate, whitespace, mapping mechanism."""
from django.test import SimpleTestCase

from apps.imports.engine.headers import (
    IDENTITY_KEYWORDS,
    alias_keys,
    analyze_headers,
    map_headers_with_aliases,
)
from apps.imports.engine.issues import Severity
from apps.imports.engine.plan import prepare_import_preview


class HeaderUnitTests(SimpleTestCase):
    def test_blank_header_is_warning(self):
        info = analyze_headers(["ID", None, "Name"])
        self.assertEqual(info["columns"][1]["status"], "blank")
        self.assertEqual(info["columns"][1]["issue"]["code"], "header_blank")
        self.assertEqual(info["columns"][1]["issue"]["severity"], Severity.WARNING)

    def test_exact_duplicate_header_is_error(self):
        info = analyze_headers(["Name", "Name"])
        col = info["columns"][1]
        self.assertEqual(col["status"], "duplicate")
        self.assertEqual(col["issue"]["code"], "header_duplicate")
        self.assertEqual(col["issue"]["severity"], Severity.ERROR)

    def test_normalized_duplicate_header_is_error(self):
        info = analyze_headers([" Email ", "EMAIL"])
        col = info["columns"][1]
        self.assertEqual(col["status"], "duplicate")
        self.assertEqual(col["issue"]["code"], "header_normalized_duplicate")

    def test_header_whitespace_is_warning_but_kept(self):
        info = analyze_headers([" Name "])
        self.assertEqual(info["columns"][0]["key"], "name")
        self.assertEqual(info["columns"][0]["issue"]["code"], "header_whitespace")

    def test_identity_indexes_detected(self):
        info = analyze_headers(["S.N.", "ID", "Name", "Email", "Phone"])
        self.assertEqual(info["identity_indexes"], [1, 3])

    def test_alias_keys_normalize(self):
        self.assertEqual(
            alias_keys(["Email", " e-mail address "]),
            {"email", "e mail address"},
        )

    def test_map_headers_exact_and_word_match(self):
        aliases = {"student_id": ["student id", "id no"], "email": ["email"]}
        mapping = map_headers_with_aliases(
            ["Student ID", "Name", "Email Address"], aliases
        )
        self.assertEqual(mapping["student_id"], 0)
        self.assertEqual(mapping["email"], 2)


class HeaderPreviewTests(SimpleTestCase):
    """Header integration tests against the generic engine path directly."""

    def _preview(self, rows, headers):
        from apps.imports.tests.helpers import xlsx_file
        return prepare_import_preview(
            xlsx_file("t.xlsx", [headers] + rows), "t.xlsx", kind="teachers"
        )

    def test_unmapped_populated_columns_surface_in_summary(self):
        planned, summary = self._preview(
            [["S1", "A1", "x@y.com"]],
            headers=["ID", "Name", "Email", "Mystery Field"],
        )
        self.assertIn("mystery field", summary["columns"]["unmapped"])

    def test_empty_populated_column_warned(self):
        planned, summary = self._preview(
            [["S1", "", "a@b.com", ""]],
            headers=["ID", "Name", "Email", "Guardian"],
        )
        codes = [a["code"] for a in summary["alerts"]]
        self.assertIn("empty_column", codes)
        self.assertIn("guardian", summary["columns"]["empty_columns"])

    def test_blank_only_sheet_rejected(self):
        from apps.academics.timetable_import import ImportFileError

        with self.assertRaises(ImportFileError) as ctx:
            self._preview([["", ""]], headers=["ID", "Name"])
        self.assertEqual(ctx.exception.code, "no_data_rows")