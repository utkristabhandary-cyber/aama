"""Workbook gating and reading for the generic import engine.

Reuses the timetable importer's semantics (``.xlsx`` only, 5 MB cap, first
worksheet, bounded reading) with generic wording, because this engine serves
every import kind. The ``ImportFileError`` taxonomy itself is imported from
the timetable module so file-level errors share one code shape.
"""
import openpyxl

from apps.academics.timetable_import import ImportFileError
from apps.imports.engine.constants import (
    MAX_DATA_ROWS,
    MAX_HEADER_SEARCH_ROWS,
    MAX_FILE_BYTES,
)


def validate_file(file_obj, file_name):
    """Reject anything that is not a readable .xlsx under the size cap."""
    lowered = (file_name or "").lower()
    if not lowered.endswith(".xlsx"):
        if lowered.endswith(".xls"):
            raise ImportFileError(
                "Legacy .xls workbooks are not supported. Save the file as "
                ".xlsx and try again.",
                "file_not_xlsx",
            )
        if lowered.endswith(".xlsm"):
            raise ImportFileError(
                "Macro-enabled .xlsm workbooks are not supported (macros are "
                "never executed). Save the file as .xlsx and try again.",
                "file_not_xlsx",
            )
        raise ImportFileError(
            f'Unsupported file type "{file_name}". Only Excel .xlsx workbooks '
            "are accepted.",
            "file_not_xlsx",
        )
    if file_obj.size > MAX_FILE_BYTES:
        raise ImportFileError(
            f"File is {file_obj.size} bytes but the maximum allowed is "
            f"{MAX_FILE_BYTES} bytes (5 MB).",
            "file_too_large",
        )


def read_worksheet(file_obj, file_name):
    """Read the first worksheet, bound to the enforced row limits.

    Returns ``(rows, sheet_name, sheet_count, populated_cells)`` where
    ``rows`` is capped at ``MAX_HEADER_SEARCH_ROWS + MAX_DATA_ROWS + 1`` so a
    hostile oversized workbook can never exhaust memory (overflow is reported
    from the bounded buffer by the planner).
    """
    validate_file(file_obj, file_name)
    try:
        workbook = openpyxl.load_workbook(file_obj, read_only=True, data_only=True)
    except Exception as exc:
        raise ImportFileError(
            "The uploaded file is not a readable Excel workbook.", "file_corrupt"
        ) from exc
    try:
        if not workbook.sheetnames:
            raise ImportFileError(
                "The workbook contains no worksheets.", "file_empty_worksheet"
            )
        sheet = workbook.worksheets[0]
        rows = []
        populated_cells = 0
        cap = MAX_HEADER_SEARCH_ROWS + MAX_DATA_ROWS + 1
        for row in sheet.iter_rows(values_only=True):
            populated_cells += sum(1 for cell in row if cell is not None)
            if len(rows) < cap:
                rows.append(row)
        return rows, sheet.title, len(workbook.sheetnames), populated_cells
    finally:
        workbook.close()