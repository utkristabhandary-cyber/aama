"""SEVERITY-ordering tests for the shared classification model."""
from django.test import SimpleTestCase

from apps.imports.engine.issues import SEVERITY_ORDER, Severity, issue, worst_severity


class SeverityTests(SimpleTestCase):
    def test_strict_ordering(self):
        self.assertEqual(
            SEVERITY_ORDER,
            (Severity.VALID, Severity.WARNING, Severity.SUSPICIOUS, Severity.ERROR),
        )

    def test_worst_severity_empty_is_valid(self):
        self.assertEqual(worst_severity([]), Severity.VALID)

    def test_worst_severity_picks_max(self):
        issues = [
            issue(Severity.WARNING, "a", "x"),
            issue(Severity.SUSPICIOUS, "b", "y"),
        ]
        self.assertEqual(worst_severity(issues), Severity.SUSPICIOUS)

    def test_error_beats_suspicious(self):
        issues = [
            issue(Severity.SUSPICIOUS, "b", "y"),
            issue(Severity.ERROR, "c", "z"),
        ]
        self.assertEqual(worst_severity(issues), Severity.ERROR)

    def test_warning_beats_valid(self):
        self.assertEqual(
            worst_severity([issue(Severity.VALID, "a", "x"), issue(Severity.WARNING, "b", "y")]),
            Severity.WARNING,
        )

    def test_issue_shape_machine_readable(self):
        item = issue(Severity.ERROR, "duplicate_identical", "msg")
        self.assertEqual(item, {"severity": "error", "code": "duplicate_identical", "message": "msg"})