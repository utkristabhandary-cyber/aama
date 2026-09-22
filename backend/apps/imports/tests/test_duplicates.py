"""DUPLICATE tests: identical vs conflicting, identity-based."""
from django.test import SimpleTestCase

from apps.imports.engine.issues import Severity
from apps.imports.engine.plan import prepare_import_preview
from apps.imports.tests.helpers import ImportsBase, xlsx_file


class DuplicateTests(SimpleTestCase):
    def _preview(self, rows, headers=None):
        return prepare_import_preview(
            xlsx_file(
                "d.xlsx",
                [headers or ["ID", "Name", "Email", "Phone"]] + rows,
            ),
            "d.xlsx",
            kind="students",
        )

    def test_identical_duplicate_is_error_on_later_row(self):
        planned, summary = self._preview([
            ["STD-001", "Ananya Verma", "ananya@aams.local", "9841-234567"],
            ["STD-001", "Ananya Verma", "ananya@aams.local", "9841-234567"],
        ])
        self.assertEqual(planned[0]["status"], "data")
        row = planned[1]
        self.assertEqual(row["status"], "duplicate_identical")
        self.assertEqual(row["classification"], "duplicate_identical")
        self.assertEqual(row["severity"], Severity.ERROR)
        self.assertIn("row 2", [i["message"] for i in row["issues"]][0])
        self.assertTrue(summary["block_confirmation"])
        self.assertEqual(summary["counts"]["duplicate_rows"], 1)

    def test_positional_sequence_difference_still_identical_duplicate(self):
        planned, _ = self._preview(
            [
                [1, "STD-001", "Ananya Verma", "ananya@aams.local", "9841-234567"],
                [2, "STD-001", "Ananya Verma", "ananya@aams.local", "9841-234567"],
            ],
            headers=["S.N.", "ID", "Name", "Email", "Phone"],
        )
        self.assertEqual(planned[1]["status"], "duplicate_identical")

    def test_same_identity_different_data_is_conflicting(self):
        planned, summary = self._preview([
            ["STD-001", "Ananya Verma", "ananya@aams.local", "9841-234567"],
            ["STD-001", "A. Verma", "ananya.v@aams.local", "9841-234567"],
        ])
        self.assertEqual(planned[1]["status"], "duplicate_conflicting")
        self.assertEqual(summary["counts"]["conflicting_rows"], 1)
        self.assertTrue(summary["block_confirmation"])

    def test_email_case_only_difference_is_duplicate(self):
        planned, _ = self._preview([
            ["STD-001", "Ananya Verma", "Ananya@Aams.Local", "9841-234567"],
            ["STD-001", "Ananya Verma", "ananya@aams.local", "9841-234567"],
        ])
        self.assertEqual(planned[1]["status"], "duplicate_identical")

    def test_different_identity_values_are_not_duplicates(self):
        planned, summary = self._preview([
            ["STD-001", "Ananya Verma", "ananya@aams.local", "9841-234567"],
            ["STD-002", "Ravi", "ravi@aams.local", "1234567890"],
        ])
        self.assertEqual([r["status"] for r in planned], ["data", "data"])
        self.assertFalse(summary["block_confirmation"])

    def test_no_identity_columns_means_no_duplicate_flagging(self):
        planned, summary = self._preview(
            [
                ["Ananya Verma", "9841-234567"],
                ["Ananya Verma", "9841-234567"],
            ],
            headers=["Name", "Phone"],
        )
        for row in planned:
            self.assertEqual(row["status"], "data")
        self.assertEqual(summary["counts"]["duplicate_rows"], 0)


class DuplicateApiTests(ImportsBase):
    PREVIEW_URL = "/api/imports/teachers/preview/"
    LIST_URL = "/api/imports/teachers/"

    def test_duplicate_file_blocks_confirmation(self):
        response = self._preview([
            ["STD-001", "Ananya Verma", "ananya@aams.local", "9841-234567"],
            ["STD-001", "Ananya Verma", "ananya@aams.local", "9841-234567"],
        ])
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["summary"]["block_confirmation"])
        self.assertEqual(response.data["summary"]["counts"]["error_rows"], 1)