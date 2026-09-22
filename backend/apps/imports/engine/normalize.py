"""Cell-level normalization helpers (server-side only).

The normalized value is what the preview exposes and, in later phases, what
gets written. The raw Excel cell is never stored verbatim in the plan; raw
strings are kept for review only, capped to a safe bound.
"""
import datetime
import re

from apps.academics.timetable_import import normalize_text
from apps.imports.engine.constants import MAX_CELL_CHARS
from apps.imports.engine.issues import Severity, issue

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_MAX_RAW_CHARS = MAX_CELL_CHARS * 2


def cell_to_text(value):
    """Mirror the timetable importer's cell conversion (trimmed + capped)."""
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, datetime.datetime):
        return value.isoformat()
    if isinstance(value, datetime.time):
        return value.strftime("%H:%M")
    if isinstance(value, (int, float)):
        return str(value)
    return normalize_text(value)[:MAX_CELL_CHARS]


def raw_to_text(value):
    """Raw cell kept for review, capped to a safe bound.

    Returns the original string (uncollapsed) when it fits, otherwise a short
    preview ending with an ellipsis. Non-string values fall back to their
    normalized text.
    """
    if not isinstance(value, str):
        return cell_to_text(value)
    if len(value) <= _MAX_RAW_CHARS:
        return value
    return value[:_MAX_RAW_CHARS] + "…"


def normalize_email(value):
    """Case-fold + trim an email, flagging malformed addresses SUSPICIOUS."""
    text = cell_to_text(value)
    if not text:
        return "", None
    lowered = text.lower()
    if not _EMAIL_RE.match(lowered):
        return lowered, issue(
            Severity.SUSPICIOUS,
            "email_malformed",
            f'"{text}" does not look like a valid email address.',
        )
    return lowered, None


def normalize_phone(value):
    """Trim a phone number; flag values with no digits SUSPICIOUS."""
    text = cell_to_text(value)
    if not text:
        return "", None
    if not re.search(r"[0-9]", text):
        return text, issue(
            Severity.SUSPICIOUS,
            "phone_no_digits",
            f'"{text}" contains no digits; this does not look like a phone number.',
        )
    return text, None


def cell_too_long(value):
    return isinstance(value, str) and len(value) > MAX_CELL_CHARS