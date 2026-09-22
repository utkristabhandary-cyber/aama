"""Row-level extraction and structural severity classification.

Phase A classifies *shape* only (the engine is kind-agnostic): 
- fully-empty / whitespace-only rows are skipped and counted (WARNING)
- rows with a blank identity/email cell while other cells are populated are
  ``partial`` → SUSPICIOUS
- anything else is a ``data`` row → VALID until further per-cell checks run

Real column→field mapping, per-field required/format checks and the
DB cross-check (new / update / unchanged / conflict) arrive in Phases B/C.
Every row carries placeholder slots (``identity`` / ``db_match`` / ``plan``)
so later phases extend this shape without changing the contract.
"""
from apps.imports.engine.constants import MAX_CELL_CHARS
from apps.imports.engine.headers import column_role
from apps.imports.engine.issues import Severity, issue, worst_severity
from apps.imports.engine.normalize import (
    cell_too_long,
    cell_to_text,
    normalize_email,
    normalize_phone,
    raw_to_text,
)


def _normalize_cell(value, role):
    """Return (text, issue|None) — structural, keyword-role based."""
    if role == "email":
        return normalize_email(value)
    if role == "phone":
        return normalize_phone(value)
    return cell_to_text(value), None


def has_content(cells):
    """True when any cell holds more than whitespace."""
    for cell in cells:
        if cell is None or isinstance(cell, bool):
            continue
        if "".join(str(cell).split()):
            return True
    return False


def classify_rows(data_rows, header_info):
    """Normalize + classify each post-header row.

    ``data_rows`` is an iterable of ``(excel_row_number, cells)`` tuples.
    Fully-empty/whitespace-only rows are counted and returned separately as
    ``(empty_count, planned)``.
    """
    planned = []
    empty_count = 0
    for row_number, cells in data_rows:
        if not has_content(cells):
            empty_count += 1
            continue

        normalized = {}
        raw_map = {}
        issues = []
        for col in header_info["columns"]:
            index = col["index"]
            if index >= len(cells):
                continue
            value = cells[index]
            raw_map[str(index)] = raw_to_text(value)
            text, cell_issue = _normalize_cell(value, column_role(col["key"]))
            if cell_issue is not None:
                issues.append(cell_issue)
            if not text:
                continue
            normalized[str(index)] = text
            if col["raw"] and cell_too_long(value):
                issues.append(issue(
                    Severity.SUSPICIOUS,
                    "cell_truncated",
                    f'Cell in column "{col["raw"]}" was longer than '
                    f"{MAX_CELL_CHARS} characters and was truncated for review.",
                ))

        identity_indexes = header_info["identity_indexes"]
        blank_identity = [
            i for i in identity_indexes if str(i) not in normalized
        ]
        if identity_indexes and blank_identity and normalized:
            issues.append(issue(
                Severity.SUSPICIOUS,
                "partial_row",
                "Row has data but its identity/email value(s) "
                f"({', '.join(str(i + 1) for i in blank_identity)}) are blank.",
            ))

        identity = None
        populated_identity = {
            str(i): normalized[str(i)]
            for i in identity_indexes
            if str(i) in normalized
        }
        if populated_identity:
            identity = {"keys": [i for i in identity_indexes], "values": populated_identity}

        severity = worst_severity(issues)
        status = "partial" if any(i["code"] == "partial_row" for i in issues) else "data"

        planned.append({
            "row": row_number,
            "cells": raw_map,
            "normalized": normalized,
            "issues": issues,
            "severity": severity,
            "status": status,
            "classification": status if status == "partial" else "new",
            "identity": identity,
            "db_match": None,
            "plan": None,
        })
    return empty_count, planned