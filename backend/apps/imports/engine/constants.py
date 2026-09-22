"""Enforcement limits for institutional Excel imports (reused, not redefined).

The authoritative values live in ``apps/academics/timetable_import.py``; the
generic engine imports them so the two pipelines can never drift apart.
"""
from apps.academics.timetable_import import (  # noqa: F401
    MAX_CELL_CHARS,
    MAX_DATA_ROWS,
    MAX_FILE_BYTES,
    MAX_HEADER_SEARCH_ROWS,
)