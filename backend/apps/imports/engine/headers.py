"""Generic header analysis (mechanism only; no institutional mapping yet).

Header *shape* checks are kind-agnostic and safe for any workbook:

- blank header cell          -> WARNING (that column's data is unreadable)
- duplicate / normalized
  collision ("E-mail" vs
  "EMAIL", " name " vs "name") -> ERROR (per docs/25 §10)
- leading/trailing whitespace -> WARNING (header was quietly normalized)
- every other non-blank header  -> "unmapped" (Phase A has no field alias
  tables yet, so populated unrecognized columns surface as WARNING in the
  summary rather than being silently dropped).

The alias-mapping *mechanism* (``map_headers_with_aliases``) mirrors the
timetable importer's ``map_columns`` and is exercised by unit tests with
sample alias sets. The authoritative per-kind alias tables are finalized in
Phases B/C once the institutional workbook is provided — nothing is guessed
here.

``IDENTITY_KEYWORDS`` is a conservative, non-institutional seed used only to
highlight partial rows and to build duplicate fingerprints.
"""
from apps.academics.timetable_import import header_key, normalize_text
from apps.imports.engine.issues import Severity, issue

IDENTITY_KEYWORDS = {
    "id",
    "identity",
    "identification",
    "student id",
    "teacher id",
    "user id",
    "username",
    "email",
    "e mail",
    "email address",
    "mail",
    "roll number",
    "roll no",
    "registration number",
    "reg no",
}

# Header-keyword roles drive *structural* cell normalization (email casing,
# phone digit check) before any real mapping exists. These are generic,
# non-institutional keyword sets, not a final column alias table.
EMAIL_KEYS = {"email", "e mail", "email address", "mail"}
PHONE_KEYS = {
    "phone",
    "phones",
    "mobile",
    "mobile number",
    "cell",
    "cell number",
    "telephone",
    "contact number",
    "contact no",
}


# Positional (sequence) columns are worksheet row markers, never data. Two rows
# that differ only in a sequence number are duplicates, not conflicts.
POSITIONAL_KEYS = {"s n", "serial", "serial no", "sl", "sl no", "sno", "sr no", "sn", "no"}


def column_role(key):
    """Return 'email' | 'phone' | 'identifier' | 'text' for a header key."""
    if key in EMAIL_KEYS:
        return "email"
    if key in PHONE_KEYS:
        return "phone"
    if key in ("id", "identity", "identification", "student id", "teacher id", "user id", "username"):
        return "identifier"
    return "text"


def analyze_headers(headers):
    """Shape-only analysis of a header row.

    Returns ``{"columns", "issues", "identity_indexes"}``. ``columns`` is the
    per-column view (raw/key/status/issue), ``issues`` aggregates every header
    issue for the summary alerts, and ``identity_indexes`` lists column indexes
    whose normalized key is an identity/email candidate.
    """
    seen_key = {}
    columns = []
    issues = []
    identity_indexes = []
    for index, raw in enumerate(headers):
        text = normalize_text(raw)
        key = header_key(raw)
        col = {
            "index": index,
            "raw": text,
            "key": key,
            "status": "blank" if not text else "unmapped",
            "issue": None,
        }
        if not text:
            col["issue"] = issue(
                Severity.WARNING,
                "header_blank",
                f"Column {index + 1} has a blank header; its data cannot be mapped.",
            )
            issues.append(col["issue"])
        else:
            if isinstance(raw, str) and raw.strip() and raw != raw.strip():
                col["issue"] = issue(
                    Severity.WARNING,
                    "header_whitespace",
                    f'Header "{text}" has leading/trailing whitespace that was removed.',
                )
                issues.append(col["issue"])

            if key in seen_key:
                first = seen_key[key]
                duplicate_same_text = (
                    isinstance(raw, str)
                    and isinstance(headers[first], str)
                    and raw.strip() == headers[first].strip()
                )
                if duplicate_same_text:
                    code = "header_duplicate"
                    message = (
                        f'Header "{text}" duplicates column {first + 1}; the '
                        "second copy is ignored."
                    )
                else:
                    code = "header_normalized_duplicate"
                    message = (
                        f'Header "{text}" collides with column {first + 1} '
                        "after case/whitespace normalization; the two columns "
                        "cannot be told apart."
                    )
                col["status"] = "duplicate"
                col["issue"] = issue(Severity.ERROR, code, message)
                issues.append(col["issue"])
            else:
                seen_key[key] = index
            if key in IDENTITY_KEYWORDS:
                identity_indexes.append(index)
        columns.append(col)
    return {"columns": columns, "issues": issues, "identity_indexes": identity_indexes}


def alias_keys(aliases):
    """Map a list of header aliases to their normalized comparison keys."""
    return {header_key(alias) for alias in aliases}


def map_headers_with_aliases(headers, field_aliases):
    """Generic header->field mapping (mirrors the timetable ``map_columns``).

    ``field_aliases`` is ``{field: [aliases...]}``. Exact alias match wins;
    otherwise a whole-word containment match is tried. Each header column is
    used for at most one field. Returns ``{field: column_index}``.
    """
    indexed = []
    for idx, cell in enumerate(headers):
        key = header_key(cell)
        if key:
            indexed.append((idx, key))
    mapping = {}
    for field, aliases in field_aliases.items():
        keys = alias_keys(aliases)
        chosen = None
        for idx, key in indexed:
            if idx in mapping.values():
                continue
            if key in keys:
                chosen = idx
                break
        if chosen is None:
            best = None
            for idx, key in indexed:
                if idx in mapping.values():
                    continue
                for alias in keys:
                    if alias and re_search_word(alias, key):
                        best = idx
                        break
                if best is not None:
                    break
            chosen = best
        if chosen is not None:
            mapping[field] = chosen
    return mapping


def re_search_word(word, key):
    """Return True when ``word`` appears as a whole word inside ``key``."""
    import re

    return bool(re.search(rf"\b{re.escape(word)}\b", key))