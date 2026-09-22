"""Generic institutional Excel import engine (Phase A).

Pure primitives reused from the proven timetable importer
(``apps/academics/timetable_import.py``) without destabilizing it:
constants (``MAX_FILE_BYTES``/``MAX_DATA_ROWS``/``MAX_CELL_CHARS``), the
``ImportFileError``/``ImportRowError`` taxonomy, and the
``normalize_text``/``header_key`` normalization helpers.

The engine is intentionally KIND-AGNOSTIC: it validates and normalizes a
workbook's shape (file, header, row and cell level), classifies rows with the
VALID/WARNING/SUSPICIOUS/ERROR severity model, detects in-file duplicates and
produces a deterministic summary + server-produced ``parsed_rows``. Real
column→model mappings arrive in later phases (B/C) once the institutional
workbook is provided; nothing here guesses institutional columns.
"""