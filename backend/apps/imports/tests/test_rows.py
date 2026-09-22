"""ROW-level tests: empty, whitespace-only, partial, normal."""
from django.test import SimpleTestCase

from apps.imports.engine.issues import Severity
from apps.imports.engine.plan import prepare_import_preview
from apps.imports.tests.helpers import xlsx_file


class RowUnitTests(SimpleTestCase):
    def _preview(self, rows, headers=None):
        return prepare_import_preview(
            xlsx_file("r.xlsx", [headers or ["ID", "Name", "Email"]] + rows),
            "r.xlsx",
            kind="students",
        )

    def test_empty_rows_counted_warning_and_skipped(self):
        planned, summary = self._preview([
            ["S1", "Alice", "alice@aams.local"],
            [],
            [None, None],
            ["  ", "  ", "  "],
        ])
        self.assertEqual(summary["counts"]["empty_rows"], 3)
        self.assertEqual(len(planned), 1)
        codes = [a["code"] for a in summary["alerts"]]
        self.assertIn("empty_row_skipped", codes)
        self.assertFalse(summary["block_confirmation"])

    def test_whitespace_only_rows_treated_as_empty(self):
        planned, summary = self._preview([
            ["S1", "Alice", "alice@aams.local"],
            ["   ", "\t", " "],
        ])
        self.assertEqual(summary["counts"]["empty_rows"], 1)
        self.assertEqual(len(planned), 1)

    def test_fully_blank_sheet_rejected_as_no_data_rows(self):
        from apps.academics.timetable_import import ImportFileError

        with self.assertRaises(ImportFileError) as ctx:
            self._preview([["  ", "  ", "  "]])
        self.assertEqual(ctx.exception.code, "no_data_rows")

    def test_valid_data_row(self):
        planned, summary = self._preview([["S1", "Alice", "alice@aams.local"]])
        self.assertEqual(len(planned), 1)
        row = planned[0]
        self.assertEqual(row["status"], "data")
        self.assertEqual(row["classification"], "new")
        self.assertEqual(row["severity"], Severity.VALID)
        self.assertEqual(row["normalized"]["1"], "Alice")
        self.assertIsNone(row["db_match"])
        self.assertIsNone(row["plan"])

    def test_blank_one_of_multiple_identity_columns_is_partial(self):
        planned, summary = self._preview(
            [["S1", "Alice", ""]], headers=["ID", "Name", "Email"]
        )
        self.assertEqual(len(planned), 1)
        row = planned[0]
        self.assertEqual(row["status"], "partial")
        self.assertEqual(row["classification"], "partial")
        self.assertEqual(row["severity"], Severity.SUSPICIOUS)
        self.assertIn("partial_row", [i["code"] for i in row["issues"]])


class RowPreviewTests(SimpleTestCase):
    """Row integration tests against the generic engine path directly."""

    def _preview(self, rows, headers=None):
        return prepare_import_preview(
            xlsx_file("r.xlsx", [headers or ["ID", "Name", "Email"]] + rows),
            "r.xlsx",
            kind="teachers",
        )

    def test_rows_carried_in_plan_shape(self):
        planned, summary = self._preview([["S1", "Alice", "alice@aams.local"]])
        self.assertEqual(len(planned), 1)
        row = planned[0]
        self.assertEqual(
            set(row.keys()),
            {"row", "cells", "normalized", "issues", "severity", "status",
             "classification", "identity", "db_match", "plan"},
        )
        self.assertEqual(summary["counts"]["total_rows"], 1)
        self.assertEqual(summary["counts"]["data_rows"], 1)
        self.assertEqual(summary["counts"]["valid_rows"], 1)