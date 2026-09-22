"""NORMALIZATION tests: deterministic server-side cell handling."""
import json

from django.test import SimpleTestCase

from apps.imports.engine.issues import Severity
from apps.imports.engine.normalize import (
    cell_to_text,
    normalize_email,
    normalize_phone,
    raw_to_text,
)
from apps.imports.engine.plan import prepare_import_preview
from apps.imports.tests.helpers import xlsx_bytes, xlsx_file


class NormalizeUnitTests(SimpleTestCase):
    def test_cell_to_text_trims_and_collapses(self):
        self.assertEqual(cell_to_text("  Ananya   Verma  "), "Ananya Verma")
        self.assertEqual(cell_to_text(None), "")
        self.assertEqual(cell_to_text(True), "")
        self.assertEqual(cell_to_text(12.5), "12.5")
        self.assertEqual(cell_to_text(0), "0")

    def test_normalize_email_lowercases_and_trims(self):
        value, problem = normalize_email(" Ananya@Aams.Local ")
        self.assertEqual(value, "ananya@aams.local")
        self.assertIsNone(problem)

    def test_normalize_email_flags_malformed(self):
        value, problem = normalize_email("ananya at aams dot local")
        self.assertEqual(value, "ananya at aams dot local")
        self.assertEqual(problem["code"], "email_malformed")
        self.assertEqual(problem["severity"], Severity.SUSPICIOUS)

    def test_normalize_phone_keeps_digits(self):
        value, problem = normalize_phone(" +91 9841-234567 ")
        self.assertEqual(value, "+91 9841-234567")
        self.assertIsNone(problem)

    def test_normalize_phone_flags_no_digits(self):
        value, problem = normalize_phone("N/A")
        self.assertEqual(problem["code"], "phone_no_digits")

    def test_raw_to_text_caps_unbounded_cells(self):
        long_value = "x" * 5000
        raw = raw_to_text(long_value)
        self.assertEqual(len(raw), 1001)
        self.assertTrue(raw.endswith("…"))


class NormalizationPlanTests(SimpleTestCase):
    def _preview(self, rows, headers=None):
        return prepare_import_preview(
            xlsx_file("n.xlsx", [headers or ["ID", "Name", "Email", "Phone"]] + rows),
            "n.xlsx",
            kind="students",
        )

    def test_emails_lowercased_in_server_plan(self):
        planned, _ = self._preview([["S1", "Alice", " Alice@Aams.Local ", "123"]])
        self.assertEqual(planned[0]["normalized"]["2"], "alice@aams.local")

    def test_malformed_email_marks_row_suspicious(self):
        planned, summary = self._preview([["S1", "Alice", "not-an-email", "123"]])
        self.assertEqual(planned[0]["severity"], Severity.SUSPICIOUS)
        self.assertIn("email_malformed", [i["code"] for i in planned[0]["issues"]])
        self.assertEqual(summary["counts"]["suspicious_rows"], 1)
        # suspicious alone never blocks confirmation
        self.assertFalse(summary["block_confirmation"])

    def test_deterministic_summary_for_same_bytes(self):
        rows = [
            ["S1", " Alice Smith ", "ALICE@aams.local", "9841-234567"],
            ["S2", "Bob", "bob@aams.local", "123"],
        ]
        bytes_a = xlsx_bytes([["ID", "Name", "Email", "Phone"]] + rows)
        bytes_b = xlsx_bytes([["ID", "Name", "Email", "Phone"]] + rows)
        _, s1 = prepare_import_preview(
            xlsx_file("a.xlsx", [["ID", "Name", "Email", "Phone"]] + rows),
            "a.xlsx", kind="students",
        )
        _, s2 = prepare_import_preview(
            xlsx_file("b.xlsx", [["ID", "Name", "Email", "Phone"]] + rows),
            "b.xlsx", kind="students",
        )
        self.assertEqual(json.dumps(s1, sort_keys=True), json.dumps(s2, sort_keys=True))
        self.assertEqual(bytes_a, bytes_b)