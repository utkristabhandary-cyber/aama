"""Supported institutional import kinds.

Phase A recognizes ``students`` and ``teachers`` (matching ``ImportKind`` on the
session model). No student/teacher import is implemented yet — these keys only
name the staging endpoint + session kind. Real per-kind alias tables and
mapping rules are finalized in Phases B/C.
"""

SUPPORTED_KINDS = ("students", "teachers")


def is_supported_kind(kind):
    return kind in SUPPORTED_KINDS