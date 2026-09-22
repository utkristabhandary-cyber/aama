"""Severity model for the institutional import engine.

Ordering is strict and used everywhere worst-case severity is computed:

    VALID < WARNING < SUSPICIOUS < ERROR

SUSPICIOUS ≠ ERROR: suspicious rows block nothing but are surfaced for admin
review; ERROR rows block confirmation. Phase A performs no writes, but the
summary still reports whether confirmation (a later phase) would be blocked.
"""


class Severity:
    VALID = "valid"
    WARNING = "warning"
    SUSPICIOUS = "suspicious"
    ERROR = "error"


SEVERITY_ORDER = (Severity.VALID, Severity.WARNING, Severity.SUSPICIOUS, Severity.ERROR)
SEVERITY_RANK = {level: rank for rank, level in enumerate(SEVERITY_ORDER)}


def issue(severity, code, message):
    """Return a machine-readable issue record.

    ``code`` is the stable machine key (used by tests and the UI); ``message``
    is the human-readable copy shown in the preview.
    """
    return {"severity": severity, "code": code, "message": message}


def worst_severity(issues):
    """Return the highest severity present in ``issues`` (VALID when none)."""
    rank = 0
    for item in issues:
        rank = max(rank, SEVERITY_RANK.get(item.get("severity"), 0))
    for level, value in SEVERITY_RANK.items():
        if value == rank:
            return level
    return Severity.VALID