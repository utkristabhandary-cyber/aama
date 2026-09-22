"""In-file duplicate detection (identical vs conflicting).

A row's identity is the set of normalized values in the workbook's
identity/email candidate columns (see ``headers.IDENTITY_KEYWORDS``). The rule
(docs/25 §11): when a later row reuses an identity value already claimed by an
earlier row, it becomes an ERROR — ``duplicate_identical`` when the whole row
is byte-identical (after normalization), ``duplicate_conflicting`` when the
same identity is reused with different data. The first occurrence is kept
untouched and the ADMIN is the sole arbiter (never auto-merge).
"""
from apps.imports.engine.headers import POSITIONAL_KEYS
from apps.imports.engine.issues import Severity, issue


def _claimed_values(row, identity_indexes):
    return [
        (index, row["normalized"][str(index)])
        for index in identity_indexes
        if str(index) in row["normalized"]
    ]


def _data_values(row, positional_indexes):
    """Row data excluding positional (sequence-number) columns."""
    return {
        key: value
        for key, value in row["normalized"].items()
        if int(key) not in positional_indexes
    }


def detect_duplicates(rows, identity_indexes, header_info=None):
    """Mark repeated identities on later rows; returns the same list."""
    if not identity_indexes:
        return rows
    positional_indexes = {
        col["index"]
        for col in (header_info or {}).get("columns", [])
        if col["key"] in POSITIONAL_KEYS
    }
    claims = {}
    for row in rows:
        if row["status"] != "data":
            continue
        first = None
        for index, value in _claimed_values(row, identity_indexes):
            owner = claims.get((index, value))
            if owner is not None and owner is not row:
                first = owner
                break
        if first is None:
            for index, value in _claimed_values(row, identity_indexes):
                claims.setdefault((index, value), row)
            continue

        identical = _data_values(row, positional_indexes) == _data_values(
            first, positional_indexes
        )
        if identical:
            code = "duplicate_identical"
            message = (
                f"Identical to row {first['row']} on the identity fields; "
                "importing it would create a duplicate record."
            )
        else:
            code = "duplicate_conflicting"
            message = (
                f"Conflicts with row {first['row']}: the same identity value "
                "is reused with different data. Resolve this before confirming."
            )
        row["classification"] = code
        row["status"] = code
        row["severity"] = Severity.ERROR
        row["issues"].append(issue(Severity.ERROR, code, message))
    return rows