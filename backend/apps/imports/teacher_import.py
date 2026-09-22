"""Teacher institutional import: mapping, planning, and confirmed execution.

Builds on the Phase A generic engine (classify, detect_duplicates,
build_summary) and mirrors the Phase B student pattern with teacher-specific
field mapping, DB cross-check (teacher_id only, email for conflict detection),
field diffs, and an all-or-nothing confirm executor.

Row shape after teacher enrichment (extends Phase A classifier output):

    row["values"]        – extracted, normalized field values
    row["field_changes"] – [{field, label, old, new}] for update rows
    row["db_match"]      – {id, matched_by} or None
    row["account"]       – account-consequence plan (Phase D)
    row["plan"]          – new | update | unchanged | duplicate | error

Only the Teacher MASTER record is created/updated by the import itself. On a
CONFIRMED import, eligible ACTIVE teachers additionally get a login account
(Phase D) committed in the same all-or-nothing transaction. No passwords, no
TeacherAssignment/timetable rows, and no master changes outside the import.
"""
import re

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.academics.models import TeacherStatus
from apps.academics.timetable_import import ImportFileError, ImportRowError
from apps.accounts.provisioning import (
    ACTION_ACCOUNT_EXISTS,
    ACTION_CONFLICT,
    ACTION_ERROR,
    ACTION_NO_ACCOUNT,
    ACTION_PROVISION,
    compute_account_action,
    index_users,
    provision_account,
)
from apps.imports.engine.classifier import classify_rows, has_content
from apps.imports.engine.constants import MAX_DATA_ROWS
from apps.imports.engine.duplicates import detect_duplicates
from apps.imports.engine.headers import analyze_headers, header_key
from apps.imports.engine.issues import Severity, issue, worst_severity
from apps.imports.engine.plan import locate_header
from apps.imports.engine.summary import build_summary
from apps.imports.engine.workbook import read_worksheet
from apps.imports.models import ImportSession
from apps.teachers.models import Teacher

User = get_user_model()

# ---------------------------------------------------------------------------
# Field alias table (Teacher-scoped; kept separate from the generic aliases)
# ---------------------------------------------------------------------------

FIELD_ALIASES = {
    "teacher_id": [
        "teacher id", "teacher id number", "staff id", "employee id",
        "employee code", "faculty id", "faculty code", "id",
    ],
    "name": ["name", "teacher name", "faculty name", "full name"],
    "email": ["email", "e mail", "email address", "mail"],
    "phone": ["phone", "phone number", "mobile", "mobile number",
              "contact number", "contact no"],
    "department": ["department", "department name", "dept", "faculty"],
    "designation": ["designation", "post", "title", "job title"],
    "qualification": [
        "qualification", "highest qualification", "academic qualification",
        "education",
    ],
    "status": ["status", "employment status", "active status"],
}

REQUIRED_FIELDS = ("teacher_id", "name", "email")

_CONTAINMENT_FIELDS = frozenset({"department", "designation", "qualification"})

# avatar is intentionally NOT importable: Teacher.avatar is a profile URL
# owned by the account layer, not an Excel-supplied attribute.

_FIELD_ALIAS_KEYS = {
    f: {header_key(a) for a in aliases}
    for f, aliases in FIELD_ALIASES.items()
}

# ---------------------------------------------------------------------------
# Status mapping (TeacherStatus: active | inactive only)
# ---------------------------------------------------------------------------

_STATUS_ALIASES = {
    "active": TeacherStatus.ACTIVE,
    "working": TeacherStatus.ACTIVE,
    "employed": TeacherStatus.ACTIVE,
    "inactive": TeacherStatus.INACTIVE,
    "left": TeacherStatus.INACTIVE,
    "resigned": TeacherStatus.INACTIVE,
    "retired": TeacherStatus.INACTIVE,
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _cell(normalized, index):
    return normalized.get(str(index), "")


def _parse_status(raw):
    text = (raw or "").strip().lower()
    if not text:
        return None, None
    canonical = _STATUS_ALIASES.get(text)
    if canonical:
        return canonical, None
    return None, issue(
        Severity.SUSPICIOUS, "status_unknown",
        f'Status "{raw}" is not recognized.',
    )


# ---------------------------------------------------------------------------
# Header mapping
# ---------------------------------------------------------------------------

def map_teacher_headers(header_info):
    """Map header columns to teacher fields; mark mapped; validate required."""
    mapping = {}
    indexed = [
        (col["index"], col["key"])
        for col in header_info["columns"]
        if col["status"] != "blank"
    ]

    for field in _FIELD_ALIAS_KEYS:
        for idx, key in indexed:
            if idx in mapping.values():
                continue
            if key in _FIELD_ALIAS_KEYS[field]:
                mapping[field] = idx
                break

    for field in _CONTAINMENT_FIELDS:
        if field in mapping:
            continue
        for idx, key in indexed:
            if idx in mapping.values():
                continue
            for alias in _FIELD_ALIAS_KEYS[field]:
                if alias and re.search(rf"\b{re.escape(alias)}\b", key):
                    mapping[field] = idx
                    break
            else:
                continue
            break

    mapped_indexes = set(mapping.values())
    for col in header_info["columns"]:
        if col["index"] in mapped_indexes:
            col["status"] = "mapped"

    missing = [f for f in REQUIRED_FIELDS if f not in mapping]
    if missing:
        pretty = ", ".join(f.replace("_", " ").title() for f in missing)
        raise ImportFileError(
            f"The spreadsheet is missing required columns: {pretty}.",
            "file_missing_required_columns",
        )

    return mapping


# ---------------------------------------------------------------------------
# Value extraction (from normalized data via mapping)
# ---------------------------------------------------------------------------

_STRING_FIELDS = (
    "teacher_id", "name", "email", "phone", "department",
    "designation", "qualification",
)


def extract_values(normalized, mapping):
    """Extract the values dict + initial per-cell issues from normalized data."""
    values = {}
    issues = []

    def get(field):
        return _cell(normalized, mapping[field]) if field in mapping else ""

    for field in _STRING_FIELDS:
        values[field] = get(field)

    if values["email"]:
        values["email"] = values["email"].lower()

    raw_status = get("status")
    parsed_status, status_issue = _parse_status(raw_status)
    if status_issue:
        issues.append(status_issue)
    values["status"] = parsed_status or ""

    return values, issues


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

def _build_lookups():
    """Snapshot current Teacher emails/ids and User emails for cross-checks."""
    teachers = list(Teacher.objects.all())
    teachers_by_id = {t.teacher_id.casefold(): t for t in teachers}
    teachers_by_email = {}
    for t in teachers:
        if t.email:
            teachers_by_email[t.email.casefold()] = t
    users_by_username, users_by_teacher, _ = index_users()
    user_emails_cf = {
        u.email.casefold() for u in users_by_username.values() if u.email
    }
    return (teachers_by_id, teachers_by_email, user_emails_cf,
            users_by_username, users_by_teacher)


# ---------------------------------------------------------------------------
# Field diff
# ---------------------------------------------------------------------------

def _compute_field_changes(existing, values):
    """Diff non-blank workbook values against the existing teacher record.

    Blank cells never overwrite (no "clear the value" via Excel). Email is
    diffed only when the workbook truly changes it.
    """
    changes = []

    def _diff(field, label, current):
        new = values.get(field)
        if not new:
            return
        current_norm = (current or "").strip()
        if current_norm.casefold() != new.casefold():
            changes.append({
                "field": field, "label": label,
                "old": current, "new": new,
            })

    _diff("name", "Name", existing.name)
    _diff("email", "Email", existing.email)
    _diff("phone", "Phone", existing.phone)
    _diff("department", "Department", existing.department)
    _diff("designation", "Designation", existing.designation)
    _diff("qualification", "Qualification", existing.qualification)

    if values.get("status") and existing.status != values["status"]:
        changes.append({
            "field": "status", "label": "Status",
            "old": existing.status, "new": values["status"],
        })

    return changes


# ---------------------------------------------------------------------------
# Row enrichment
# ---------------------------------------------------------------------------

def enrich_row(row, values, teachers_by_id, teachers_by_email, user_emails_cf,
               users_by_username, users_by_teacher):
    """Enrich a row: required checks, DB match, email conflict, plan, and the
    Phase D account consequence."""
    row["issues"] = list(row.get("issues") or [])
    row["values"] = values

    for field, code in (
        ("teacher_id", "missing_teacher_id"),
        ("name", "missing_name"),
        ("email", "missing_email"),
    ):
        if not values.get(field):
            row["issues"].append(issue(
                Severity.ERROR, code,
                f'{field.replace("_", " ").title()} is required.',
            ))

    teacher_id = (values.get("teacher_id") or "").strip()
    email = (values.get("email") or "").strip()

    existing = None
    if teacher_id:
        existing = teachers_by_id.get(teacher_id.casefold())

    db_match = None
    if existing:
        db_match = {"id": existing.pk, "matched_by": "teacher_id"}

        if email:
            email_eq_existing = (
                (existing.email or "").casefold() == email.casefold()
            )
            other_teacher = teachers_by_email.get(email.casefold())
            if other_teacher and other_teacher.pk != existing.pk:
                row["issues"].append(issue(
                    Severity.ERROR, "email_conflict",
                    f'Email "{email}" belongs to another teacher '
                    f'({other_teacher.name}).',
                ))
            elif email.casefold() in user_emails_cf and not email_eq_existing:
                row["issues"].append(issue(
                    Severity.ERROR, "email_conflict",
                    f'Email "{email}" is already in use by another account.',
                ))
    else:
        if email:
            owner = teachers_by_email.get(email.casefold())
            if owner:
                row["issues"].append(issue(
                    Severity.ERROR, "email_conflict",
                    f'Email "{email}" belongs to another teacher '
                    f'({owner.name}).',
                ))
            elif email.casefold() in user_emails_cf:
                row["issues"].append(issue(
                    Severity.ERROR, "email_conflict",
                    f'Email "{email}" is already in use by an existing account.',
                ))

    row["db_match"] = db_match

    # -- Phase D account consequence (computed safely; never creates) ----
    if existing is not None:
        effective_status = values.get("status") or existing.status
        linked_user = users_by_teacher.get(existing.pk)
    else:
        effective_status = values.get("status") or TeacherStatus.ACTIVE
        linked_user = None

    account_action, account_username, account_message = compute_account_action(
        "teachers", values.get("teacher_id") or "", effective_status,
        linked_user, users_by_username,
    )

    if account_action == ACTION_CONFLICT:
        row["issues"].append(issue(
            Severity.ERROR, "username_collision",
            f'Institutional ID "{values.get("teacher_id", "")}" is already the '
            "login username of another account. Duplicate identities are "
            "never auto-merged.",
        ))

    row["account"] = {
        "action": account_action,
        "username": account_username,
        "role": "teacher",
        "must_change_password": (
            True if account_action == ACTION_PROVISION else None
        ),
        "message": account_message,
    }

    field_changes = []
    if db_match:
        existing_obj = Teacher.objects.get(pk=db_match["id"])
        field_changes = _compute_field_changes(existing_obj, values)
    row["field_changes"] = field_changes

    if row["status"] in ("duplicate_identical", "duplicate_conflicting"):
        row["plan"] = "duplicate"
    elif any(i["severity"] == Severity.ERROR for i in row["issues"]):
        row["plan"] = "error"
    elif db_match:
        row["plan"] = "update" if field_changes else "unchanged"
    else:
        row["plan"] = "new"

    if row["plan"] in ("error", "duplicate") and account_action != ACTION_CONFLICT:
        row["account"] = {
            "action": ACTION_ERROR,
            "username": account_username,
            "role": "teacher",
            "must_change_password": None,
            "message": "Row is blocked; no account changes are planned.",
        }

    row["severity"] = worst_severity(row["issues"])
    row["classification"] = row["plan"]
    if row["plan"] == "update":
        row["status"] = "update"
    elif row["plan"] == "unchanged":
        row["status"] = "unchanged"


# ---------------------------------------------------------------------------
# Summary builder
# ---------------------------------------------------------------------------

def _account_counts(planned):
    """Count the Phase D account-consequence actions across planned rows."""
    counts = {
        "provision": 0,
        "account_exists": 0,
        "no_account": 0,
        "conflict": 0,
    }
    for r in planned:
        action = r.get("account", {}).get("action")
        if action in counts:
            counts[action] += 1
    return counts


def build_teacher_summary(header_info, planned, alerts, sheet_meta,
                          empty_rows):
    summary = build_summary(
        planned, header_info, alerts, sheet_meta,
        empty_rows=empty_rows, kind="teachers",
    )

    plan_counts = {}
    for p in ("new", "update", "unchanged", "duplicate", "error"):
        plan_counts[p] = sum(1 for r in planned if r["plan"] == p)
    summary["plans"] = plan_counts

    summary["accounts"] = _account_counts(planned)

    summary["changes"] = {
        "rows_with_changes": sum(1 for r in planned if r["field_changes"]),
        "change_fields": sorted({
            c["field"] for r in planned for c in r["field_changes"]
        }),
    }
    return summary


# ---------------------------------------------------------------------------
# Preview orchestrator
# ---------------------------------------------------------------------------

def prepare_teacher_preview(file_obj, file_name):
    """Full teacher preview pipeline: map → classify → enrich → summary."""
    rows, sheet_name, sheet_count, populated_cells = read_worksheet(
        file_obj, file_name
    )
    if populated_cells == 0:
        raise ImportFileError(
            "The first worksheet contains no data.", "file_empty_worksheet"
        )
    header_row_index = locate_header(rows)
    if header_row_index is None:
        raise ImportFileError(
            "Could not locate a header row. A header row with column "
            "titles is required.",
            "header_not_found",
        )

    header_info = analyze_headers(rows[header_row_index])
    mapping = map_teacher_headers(header_info)

    teacher_identity = [
        mapping[f] for f in ("teacher_id", "email") if f in mapping
    ]

    classify_info = dict(header_info)
    classify_info["identity_indexes"] = teacher_identity

    data_cells = list(rows[header_row_index + 1:])
    meaningful = sum(1 for cells in data_cells if has_content(cells))
    if meaningful > MAX_DATA_ROWS:
        raise ImportFileError(
            f"The first worksheet has {meaningful} data rows, but the "
            f"maximum supported is {MAX_DATA_ROWS} rows.",
            "file_too_many_rows",
        )
    if meaningful == 0:
        raise ImportFileError(
            "The worksheet contains no data rows after the header row.",
            "no_data_rows",
        )

    empty_count, planned = classify_rows(
        [(header_row_index + 2 + i, list(cells))
         for i, cells in enumerate(data_cells)],
        classify_info,
    )

    detect_duplicates(planned, teacher_identity, header_info=header_info)

    teachers_by_id, teachers_by_email, user_emails_cf, users_by_username, \
        users_by_teacher = _build_lookups()

    for row in planned:
        values, extract_issues = extract_values(row["normalized"], mapping)
        row["issues"].extend(extract_issues)
        enrich_row(
            row, values, teachers_by_id, teachers_by_email, user_emails_cf,
            users_by_username, users_by_teacher,
        )

    alerts = list(header_info["issues"])

    summary_data = build_teacher_summary(
        header_info, planned, alerts,
        {"sheet_name": sheet_name, "sheet_count": sheet_count},
        empty_rows=empty_count,
    )
    return planned, summary_data


# ---------------------------------------------------------------------------
# Confirm executor
# ---------------------------------------------------------------------------

def provision_teacher_account(profile, values):
    """Create + link a teacher login inside the confirmed-import transaction.

    Any constraint failure aborts the whole import (the outer
    ``transaction.atomic()`` rolls the master rows back too).
    """
    try:
        provision_account(profile, "teachers", values)
    except (ValidationError, IntegrityError) as exc:
        messages = getattr(exc, "messages", None) or [str(exc)]
        raise ImportRowError(
            "Account provisioning failed for "
            f'{values.get("teacher_id", "")}: {messages[0]}',
            "provisioning_failed",
        )


def execute_teacher_confirm(session):
    """Re-validate + atomic commit for a pending teacher import session.

    All-or-nothing: any blocking error → entire import refused (ImportRowError).
    Eligible ACTIVE rows also get their login accounts committed in the same
    transaction — never partially. Teacher master rows are the only master
    changes; no assignments/timetable rows are ever touched.
    """
    (teachers_by_id, teachers_by_email, user_emails_cf,
     users_by_username, users_by_teacher) = _build_lookups()

    rechecked = []
    for raw_row in session.parsed_rows:
        row = dict(raw_row)
        row["issues"] = []
        enrich_row(
            row, raw_row["values"], teachers_by_id, teachers_by_email,
            user_emails_cf, users_by_username, users_by_teacher,
        )
        rechecked.append(row)

    blocking = [
        r for r in rechecked
        if r["plan"] in ("error", "duplicate")
    ]
    if blocking:
        codes = {}
        for r in blocking:
            for i in r["issues"]:
                if i["severity"] == Severity.ERROR:
                    codes[i["code"]] = codes.get(i["code"], 0) + 1
        parts = [f'{c} ({n})' for c, n in sorted(codes.items())]
        raise ImportRowError(
            f"Import blocked: {len(blocking)} row(s) have errors or "
            f"conflicts [{', '.join(parts)}].",
            "blocked_teacher_errors",
        )

    created = updated = unchanged = accounts_provisioned = 0

    with transaction.atomic():
        for row in rechecked:
            values = row["values"]
            plan = row["plan"]
            account = row.get("account", {})

            master = None
            if plan == "unchanged":
                unchanged += 1
                if account.get("action") == ACTION_PROVISION:
                    master = Teacher.objects.get(pk=row["db_match"]["id"])

            elif plan == "new":
                obj = Teacher(
                    teacher_id=values["teacher_id"],
                    name=values["name"],
                    email=values["email"],
                    phone=values.get("phone", ""),
                    department=values.get("department", ""),
                    designation=values.get("designation", ""),
                    qualification=values.get("qualification", ""),
                    status=values.get("status") or TeacherStatus.ACTIVE,
                )
                try:
                    obj.full_clean()
                except ValidationError as exc:
                    raise ImportRowError(
                        "Row for teacher "
                        f'"{values.get("teacher_id", "")}" failed validation: '
                        + "; ".join(exc.messages),
                        "row_validation_failed",
                    ) from exc
                obj.save()
                created += 1
                master = obj

            elif plan == "update":
                existing = Teacher.objects.get(pk=row["db_match"]["id"])
                saved_fields = set()
                for change in row["field_changes"]:
                    fname = change["field"]
                    setattr(existing, fname, change["new"])
                    saved_fields.add(fname)
                if saved_fields:
                    try:
                        existing.full_clean()
                    except ValidationError as exc:
                        raise ImportRowError(
                            "Row for teacher "
                            f'"{values.get("teacher_id", "")}" failed validation: '
                            + "; ".join(exc.messages),
                            "row_validation_failed",
                        ) from exc
                    existing.save(update_fields=sorted(saved_fields))
                    updated += 1
                else:
                    unchanged += 1
                master = existing

            if account.get("action") == ACTION_PROVISION and master is not None:
                provision_teacher_account(master, values)
                accounts_provisioned += 1

    session.status = ImportSession.Status.CONFIRMED
    session.confirmed_at = timezone.now()
    summary = dict(session.summary)
    summary["confirmed"] = {
        "total": len(rechecked),
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "accounts_provisioned": accounts_provisioned,
    }
    session.summary = summary
    session.save(update_fields=["status", "confirmed_at", "summary"])
    return rechecked, session.summary