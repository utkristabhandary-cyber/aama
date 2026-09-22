"""Shared exception taxonomy for the generic import engine.

The classes are imported from ``apps.academics.timetable_import`` — the same
exceptions the timetable pipeline already produces — so error handling stays
uniform across every institutional import.
"""
from apps.academics.timetable_import import (  # noqa: F401
    ImportFileError,
    ImportRowError,
)


class UnsupportedImportKindError(Exception):
    """Raised when a client supplies an import kind that does not exist."""