"""Orchestration: raw workbook -> server-produced plan + summary (Phase A).

The generalized analogue of the timetable importer's ``prepare_preview``:
gate the file -> read the first worksheet -> locate the header row -> analyze
header shape -> extract & classify data rows -> detect in-file duplicates ->
build the deterministic summary. Nothing here writes to the database; the
staging session is created by the view.
"""
from apps.academics.timetable_import import ImportFileError
from apps.imports.engine import classifier, duplicates, headers as header_module
from apps.imports.engine.constants import MAX_HEADER_SEARCH_ROWS, MAX_DATA_ROWS
from apps.imports.engine.issues import Severity, issue
from apps.imports.engine.summary import build_summary
from apps.imports.engine.workbook import read_worksheet


def _populated_count(cells):
    return sum(
        1
        for cell in cells
        if cell is not None
        and not isinstance(cell, bool)
        and "".join(str(cell).split())
    )


def locate_header(rows):
    """First row (within the enforced search window) with >= 2 populated cells."""
    limit = min(len(rows), MAX_HEADER_SEARCH_ROWS)
    for idx in range(limit):
        if _populated_count(rows[idx]) >= 2:
            return idx
    return None


def prepare_import_preview(file_obj, file_name, kind=None):
    """Parse, normalize and classify an uploaded workbook (no writes)."""
    rows, sheet_name, sheet_count, populated_cells = read_worksheet(file_obj, file_name)

    if populated_cells == 0:
        raise ImportFileError(
            "The first worksheet contains no data at all.", "file_empty_worksheet"
        )

    header_row_index = locate_header(rows)
    if header_row_index is None:
        raise ImportFileError(
            "Could not locate a header row within the first rows of the "
            "worksheet. An importable file needs a header row of column titles.",
            "header_not_found",
        )

    header_info = header_module.analyze_headers(rows[header_row_index])

    data_cells = list(rows[header_row_index + 1 :])
    meaningful = sum(1 for cells in data_cells if classifier.has_content(cells))
    if meaningful > MAX_DATA_ROWS:
        raise ImportFileError(
            f"The first worksheet has {meaningful} data rows, but the maximum "
            f"supported is {MAX_DATA_ROWS} rows.",
            "file_too_many_rows",
        )
    if meaningful == 0:
        raise ImportFileError(
            "The worksheet contains no data rows after the header row.",
            "no_data_rows",
        )

    empty_count, planned = classifier.classify_rows(
        [(header_row_index + 2 + i, list(cells)) for i, cells in enumerate(data_cells)],
        header_info,
    )

    duplicates.detect_duplicates(
        planned, header_info["identity_indexes"], header_info=header_info
    )

    alerts = list(header_info["issues"])
    empty_columns = []
    for col in header_info["columns"]:
        if not col["key"] or col["status"] == "duplicate":
            continue
        if not any(str(col["index"]) in row["normalized"] for row in planned):
            empty_columns.append(col["key"])
            alerts.append(issue(
                Severity.WARNING,
                "empty_column",
                f'Column "{col["raw"]}" has a header but no data in any row.',
            ))
    if empty_count > 0:
        alerts.append(issue(
            Severity.WARNING,
            "empty_row_skipped",
            f"Skipped {empty_count} fully-empty or whitespace-only row(s).",
        ))

    sheet_meta = {"sheet_name": sheet_name, "sheet_count": sheet_count}
    summary_data = build_summary(
        planned,
        header_info,
        alerts,
        sheet_meta,
        empty_rows=empty_count,
        kind=kind,
        empty_columns=empty_columns,
    )
    return planned, summary_data