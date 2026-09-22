"""AAMS Excel template generation (Phase H).

Every template is a **headers-only** workbook:

- Sheet 1 (``"Template"``) carries exactly the header row of the intended
  import contract and *nothing else* -- no fake rows, no sample data. Because
  the import pipeline reads the first worksheet, uploading a blank template
  must produce the deterministic ``no_data_rows`` rejection, never a crash.
- Sheet 2 (``"Import Contract"``) documents the contract: which columns are
  required, which are optional/mapped, which are accepted-but-not-stored, and
  the enforced limits. This sheet is documentation only and is never read by
  the importer (it always reads the first worksheet).

Labels are honest: the student template is the **official institutional
format** (verbatim column list); the teacher and timetable templates are the
**current AAMS system format** (the institution has not yet supplied those
workbooks, so AAMS does not pretend to know their column layout).
"""
import io

import openpyxl

from apps.academics.timetable_import import (
    MAX_CELL_CHARS,
    MAX_DATA_ROWS,
    MAX_FILE_BYTES,
)
from apps.imports.contracts import (
    STUDENT_EXPORT_FILENAME,
    STUDENT_HEADER_FIELD,
    STUDENT_HEADER_STATUS,
    STUDENT_INSTITUTIONAL_HEADERS,
    STUDENT_TEMPLATE_LABEL,
    TEACHER_EXPORT_FILENAME,
    TEACHER_HEADER_STATUS,
    TEACHER_SYSTEM_HEADERS,
    TEACHER_TEMPLATE_LABEL,
    TIMETABLE_EXPORT_FILENAME,
    TIMETABLE_HEADER_STATUS,
    TIMETABLE_SYSTEM_HEADERS,
    TIMETABLE_TEMPLATE_LABEL,
)

# Human explanations for each classification (shared by the contract sheet and
# the frontend required-field guidance; keep in sync with templateContract.ts).
STATUS_DESCRIPTIONS = {
    "required": "Required. The import is refused if this column is missing.",
    "mapped": "Optional. Stored when present and parseable.",
    "informational": "Recognised but NOT saved. The importer reports it and discards it.",
    "positional": "Worksheet row marker. Never treated as data.",
    "not_stored": "Accepted but NOT stored. The institution's column is documented and safely ignored.",
}


def _contract_rows(headers, status_map, field_map=None, label=None):
    """Rows for the Sheet-2 contract: Column | Status | AAMS Field | Notes."""
    rows = [["Column", "Status", "AAMS Field", "Notes"]]
    if label:
        rows.append([label, "", "", ""])
    for header in headers:
        status = status_map.get(header, "not_stored")
        field = (field_map or {}).get(header, "")
        description = STATUS_DESCRIPTIONS.get(status, "")
        rows.append([header, status, field, description])
    rows.append(["[Limits]", "", "", ""])
    rows.append(["", ".xlsx only", "", f"maximum {MAX_FILE_BYTES // (1024 * 1024)} MB"])
    rows.append(["", "data rows", "", f"maximum {MAX_DATA_ROWS} rows"])
    rows.append(["", "cell length", "", f"maximum {MAX_CELL_CHARS} characters per cell"])
    return rows


def _xlsx_bytes(sheet1_title, sheet1_headers, sheet2_rows):
    """Render a two-sheet workbook to bytes."""
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = sheet1_title
    sheet.append(sheet1_headers)
    for cell in sheet[1]:
        cell.font = openpyxl.styles.Font(bold=True)

    contract = workbook.create_sheet("Import Contract")
    for row in sheet2_rows:
        contract.append(row)
    for idx, cell in enumerate(contract[1], start=1):
        cell.font = openpyxl.styles.Font(bold=True)
    for idx, letter in enumerate("ABCD", start=1):
        contract.column_dimensions[letter].width = 34 if idx <= 2 else 60

    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


def build_student_template_bytes():
    """Official institutional student roster format (headers only + contract)."""
    rows = _contract_rows(
        STUDENT_INSTITUTIONAL_HEADERS,
        STUDENT_HEADER_STATUS,
        field_map=STUDENT_HEADER_FIELD,
        label=STUDENT_TEMPLATE_LABEL,
    )
    return _xlsx_bytes("Students", STUDENT_INSTITUTIONAL_HEADERS, rows)


def build_teacher_template_bytes():
    """Current AAMS teacher format (headers only + contract)."""
    rows = _contract_rows(
        TEACHER_SYSTEM_HEADERS,
        TEACHER_HEADER_STATUS,
        label=TEACHER_TEMPLATE_LABEL,
    )
    return _xlsx_bytes("Teachers", TEACHER_SYSTEM_HEADERS, rows)


def build_timetable_template_bytes():
    """Current AAMS timetable format (headers only + contract)."""
    rows = _contract_rows(
        TIMETABLE_SYSTEM_HEADERS,
        TIMETABLE_HEADER_STATUS,
        label=TIMETABLE_TEMPLATE_LABEL,
    )
    return _xlsx_bytes("Timetable", TIMETABLE_SYSTEM_HEADERS, rows)


# Export filenames referenced by the views (single source of truth).
EXPORT_FILENAMES = {
    "students": STUDENT_EXPORT_FILENAME,
    "teachers": TEACHER_EXPORT_FILENAME,
    "timetable": TIMETABLE_EXPORT_FILENAME,
}