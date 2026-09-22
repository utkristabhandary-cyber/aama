"""Deterministic import summary generation.

Same workbook bytes + same DB state always produce the same summary (order of
``unmapped``/``empty_columns`` keys is column-order, never set-order). The
summary is stored on the session and returned to the client; it is the compact,
auditable result of the system check.
"""
from apps.imports.engine.issues import Severity


def build_summary(planned, header_info, alerts, sheet_meta, empty_rows=0, kind=None, empty_columns=None):
    """Summarize the classified plan (server-produced, deterministic)."""
    counts = {
        "total_rows": len(planned),
        "data_rows": 0,
        "valid_rows": 0,
        "warning_rows": 0,
        "suspicious_rows": 0,
        "error_rows": 0,
        "empty_rows": empty_rows,
        "partial_rows": 0,
        "duplicate_rows": 0,
        "conflicting_rows": 0,
    }
    for row in planned:
        if row["severity"] == Severity.VALID:
            counts["valid_rows"] += 1
        elif row["severity"] == Severity.WARNING:
            counts["warning_rows"] += 1
        elif row["severity"] == Severity.SUSPICIOUS:
            counts["suspicious_rows"] += 1
        else:
            counts["error_rows"] += 1
        if row["status"] == "partial":
            counts["partial_rows"] += 1
        elif row["status"] == "duplicate_identical":
            counts["duplicate_rows"] += 1
        elif row["status"] == "duplicate_conflicting":
            counts["conflicting_rows"] += 1
        else:
            counts["data_rows"] += 1

    columns_out = {
        "total": len(header_info["columns"]),
        "blank": 0,
        "duplicates": 0,
        "identity": [c["key"] for c in header_info["columns"] if c["index"] in header_info["identity_indexes"]],
        "unmapped": [c["key"] for c in header_info["columns"] if c["status"] == "unmapped" and c["key"]],
        "empty_columns": empty_columns or [],
    }
    for col in header_info["columns"]:
        if col["status"] == "blank":
            columns_out["blank"] += 1
        elif col["status"] == "duplicate":
            columns_out["duplicates"] += 1

    block_confirmation = counts["error_rows"] > 0 or any(
        item.get("severity") == Severity.ERROR for item in alerts
    )

    return {
        "kind": kind,
        "file": {
            "sheet_name": sheet_meta["sheet_name"],
            "sheet_count": sheet_meta["sheet_count"],
        },
        "counts": counts,
        "columns": columns_out,
        "block_confirmation": block_confirmation,
        "alerts": alerts,
    }