"""Student institutional import: planning, enrichment, and confirmed execution.

Builds on the Phase A generic engine (classify, detect_duplicates,
build_summary) with student-specific mapping, semester/section resolution,
DB cross-check, field diffs, and an all-or-nothing confirm executor.

Row shape after student enrichment (extends Phase A classifier output):

    row["values"]        – extracted, normalized field values
    row["placement"]     – resolved semester/section + placement_change
    row["field_changes"] – [{field, label, old, new}] for update rows
    row["db_match"]      – {id, matched_by} or None
    row["account"]       – account-consequence plan (Phase D)
    row["plan"]          – new | update | unchanged | duplicate | error

Phase D (account provisioning): a confirmed import creates a login account
for every eligible ACTIVE student whose institutional ID is not already used.
Preview NEVER creates anything; account consequences are computed safely and
committed inside the same all-or-nothing transaction as the master rows.
See apps/accounts/provisioning for the exact eligibility/identity rules.
"""
import re
from datetime import date

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.academics.models import Section, Semester, StudentStatus
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
from apps.students.models import Student

User = get_user_model()

# ---------------------------------------------------------------------------
# Field alias table
# ---------------------------------------------------------------------------

FIELD_ALIASES = {
    "student_id": [
        "student id", "student id number", "id number", "id",
        "registration", "reg id", "enrollment number", "enrollment no",
    ],
    "roll_no": [
        "roll number", "roll no", "roll no.", "roll",
        "register number", "reg no", "roll number.",
    ],
    "name": ["name", "student name", "full name"],
    "email": ["email", "e mail", "email address", "mail"],
    "phone": ["phone", "phone number", "mobile", "contact number", "contact no"],
    "dob": [
        "dob", "dob (a.d.)", "dob (ad)", "date of birth",
        "date of birth (a.d.)", "birth date",
    ],
    "dob_bs": [
        "dob (b.s.)", "dob (bs)", "date of birth (b.s.)",
        "date of birth (bs)",
    ],
    "address": [
        "address", "perm address", "permanent address",
        "home address", "current address",
    ],
    "guardian_name": [
        "guardian name", "father's name", "father name",
        "guardian", "parent name",
    ],
    "guardian_phone": [
        "guardian phone", "guardian phone number",
        "father's phone", "parent phone",
    ],
    "admission_year": [
        "joined date", "admission year", "year of admission",
        "joined", "admission",
    ],
    "status": ["status", "student status"],
    "gender": ["gender", "sex"],
    "section": [
        "program sec", "section", "program / sec",
        "program/section", "program sec.", "class/section",
        "section/class", "program-sec", "program-sec.",
    ],
    "semester": [
        "year semester", "year / semester", "semester",
        "year/semester", "sem", "year sem", "year-sem",
    ],
}

REQUIRED_FIELDS = ("student_id", "name", "email", "roll_no")

_CONTAINMENT_FIELDS = frozenset({"phone", "status", "section", "semester"})

_FIELD_ALIAS_KEYS = {
    f: {header_key(a) for a in aliases}
    for f, aliases in FIELD_ALIASES.items()
}

# ---------------------------------------------------------------------------
# Status mapping
# ---------------------------------------------------------------------------

_STATUS_ALIASES = {
    "active": StudentStatus.ACTIVE,
    "enrolled": StudentStatus.ACTIVE,
    "current": StudentStatus.ACTIVE,
    "graduated": StudentStatus.GRADUATED,
    "passed": StudentStatus.GRADUATED,
    "alumni": StudentStatus.GRADUATED,
    "inactive": StudentStatus.INACTIVE,
    "left": StudentStatus.INACTIVE,
    "dropped": StudentStatus.INACTIVE,
}

_ORDINAL_RE = re.compile(r"(\d{1,2})(?:st|nd|rd|th)?")
_SECTION_SPLIT_RE = re.compile(r"[\s/\-–—]+")


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _cell(normalized, index):
    return normalized.get(str(index), "")


def _extract_ordinal(text):
    if not text:
        return None
    m = _ORDINAL_RE.search(text.lower())
    return int(m.group(1)) if m else None


def _parse_int(raw):
    text = (raw or "").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def _parse_dob(text):
    if not text:
        return None, None
    bare = text.split("T")[0] if "T" in text else text
    try:
        return date.fromisoformat(bare), None
    except ValueError:
        pass
    parts = re.split(r"[/\-]", bare)
    if len(parts) != 3:
        return None, issue(
            Severity.SUSPICIOUS, "dob_malformed",
            f'Date "{text}" could not be parsed.',
        )
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None, issue(
            Severity.SUSPICIOUS, "dob_malformed",
            f'Date "{text}" could not be parsed.',
        )
    if len(parts[0]) == 4:
        try:
            return date(nums[0], nums[1], nums[2]), None
        except ValueError:
            return None, issue(
                Severity.SUSPICIOUS, "dob_malformed",
                f'Date "{text}" is not a valid calendar date.',
            )
    if len(parts[2]) == 4:
        try:
            return date(nums[2], nums[1], nums[0]), None
        except ValueError:
            pass
        try:
            return date(nums[2], nums[0], nums[1]), None
        except ValueError:
            return None, issue(
                Severity.SUSPICIOUS, "dob_malformed",
                f'Date "{text}" is not a valid calendar date.',
            )
    return None, issue(
        Severity.SUSPICIOUS, "dob_malformed",
        f'Date "{text}" could not be parsed.',
    )


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

def map_student_headers(header_info):
    """Map header columns to student fields; mark mapped; validate required."""
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

def extract_values(normalized, mapping):
    """Extract the values dict + initial per-cell issues from normalized data."""
    values = {}
    issues = []

    def get(field):
        return _cell(normalized, mapping[field]) if field in mapping else ""

    for field in (
        "student_id", "name", "email", "phone",
        "address", "guardian_name", "guardian_phone", "roll_no",
    ):
        values[field] = get(field)

    if values["email"]:
        values["email"] = values["email"].lower()

    dob_text = get("dob")
    if dob_text:
        parsed_dob, dob_issue = _parse_dob(dob_text)
        if dob_issue:
            issues.append(dob_issue)
        values["dob"] = parsed_dob.isoformat() if parsed_dob else ""
    else:
        values["dob"] = ""

    if get("dob_bs"):
        issues.append(issue(
            Severity.WARNING, "dob_bs_unconvertible",
            "DOB (B.S.) values cannot be converted to A.D. DOB was left blank.",
        ))

    raw_status = get("status")
    parsed_status, status_issue = _parse_status(raw_status)
    if status_issue:
        issues.append(status_issue)
    values["status"] = parsed_status or ""

    admission_text = get("admission_year")
    if admission_text:
        ay = _parse_int(admission_text)
        if ay is not None:
            values["admission_year"] = ay
        else:
            values["admission_year"] = None
            issues.append(issue(
                Severity.SUSPICIOUS, "admission_year_malformed",
                f'Admission year "{admission_text}" is not a valid number.',
            ))
    else:
        values["admission_year"] = None

    gender_text = get("gender")
    values["gender"] = gender_text
    if gender_text:
        issues.append(issue(
            Severity.VALID, "gender_not_importable",
            f'Gender "{gender_text}" is informational only and will not be saved.',
        ))

    values["semester_raw"] = get("semester")
    values["section_raw"] = get("section")

    values["program_token"] = ""
    section_raw = values["section_raw"]
    if section_raw:
        parts = _SECTION_SPLIT_RE.split(section_raw)
        if len(parts) > 1:
            values["program_token"] = " ".join(p for p in parts[:-1] if p)

    return values, issues


# ---------------------------------------------------------------------------
# Semester / section resolution
# ---------------------------------------------------------------------------

def _resolve_semester(raw, semesters):
    text = (raw or "").strip()
    if not text:
        return None, "blank"
    cf = text.casefold()
    exact = [
        s for s in semesters
        if s.code.casefold() == cf or s.name.casefold() == cf
    ]
    if len(exact) == 1:
        return exact[0], "ok"
    if len(exact) > 1:
        return None, "ambiguous"
    ordinal = _extract_ordinal(text)
    if ordinal is None:
        return None, "unknown"
    candidates = [
        s for s in semesters
        if _extract_ordinal(s.name) == ordinal
        or _extract_ordinal(s.code) == ordinal
    ]
    if not candidates:
        return None, "unknown"
    if len(candidates) == 1:
        return candidates[0], "ok"
    active = [s for s in candidates if s.status == "active"]
    if len(active) == 1:
        return active[0], "ok"
    return None, "ambiguous"


def _resolve_section(raw, semester):
    text = (raw or "").strip()
    if not text:
        return None, None, "blank"
    if semester is None:
        return None, None, "no_semester"
    sections = list(semester.sections.all())
    cf = text.casefold()
    exact = [s for s in sections if s.name.casefold() == cf]
    if len(exact) == 1:
        return exact[0].name, "", "ok"
    if len(exact) > 1:
        return None, None, "ambiguous"
    parts = _SECTION_SPLIT_RE.split(text)
    if len(parts) > 1:
        last = parts[-1]
        sec_matches = [s for s in sections if s.name.casefold() == last.casefold()]
        if len(sec_matches) == 1:
            program = " ".join(p for p in parts[:-1] if p)
            return sec_matches[0].name, program, "ok"
    return None, None, "unknown"


def _resolve_placement(values, semesters):
    """Resolve semester + section; return placement dict and issues list."""
    placement_issues = []
    program_token = values.get("program_token", "")

    semester_obj, sem_outcome = _resolve_semester(
        values.get("semester_raw", ""), semesters
    )

    if sem_outcome == "blank":
        placement_issues.append(issue(
            Severity.WARNING, "placement_blank",
            "Row has no semester or section value; placement will not be updated.",
        ))
    elif sem_outcome == "unknown":
        placement_issues.append(issue(
            Severity.ERROR, "semester_unknown",
            f'Semester "{values.get("semester_raw", "")}" does not match '
            "any existing semester.",
        ))
    elif sem_outcome == "ambiguous":
        placement_issues.append(issue(
            Severity.ERROR, "semester_ambiguous",
            f'Semester "{values.get("semester_raw", "")}" matches multiple '
            "semesters; narrow the value.",
        ))

    section_name = None
    if semester_obj and sem_outcome == "ok":
        section_name, prog_from_section, sec_outcome = _resolve_section(
            values.get("section_raw", ""), semester_obj
        )
        if sec_outcome == "unknown":
            placement_issues.append(issue(
                Severity.ERROR, "section_unknown",
                f'Section "{values.get("section_raw", "")}" does not exist '
                f'in "{semester_obj.name}".',
            ))
        elif sec_outcome == "ambiguous":
            placement_issues.append(issue(
                Severity.ERROR, "section_ambiguous",
                f'Section "{values.get("section_raw", "")}" is ambiguous '
                f'in "{semester_obj.name}".',
            ))
        elif prog_from_section and not program_token:
            program_token = prog_from_section
            values["program_token"] = program_token

        if program_token:
            placement_issues.append(issue(
                Severity.VALID, "program_unmapped",
                f'Program token "{program_token}" is informational only; '
                "no Program entity exists in the domain model.",
            ))

    placement = {
        "semester": (
            {"id": semester_obj.pk, "code": semester_obj.code,
             "name": semester_obj.name}
            if semester_obj else None
        ),
        "section": section_name,
        "program_token": program_token,
        "placement_change": False,
    }
    return placement, placement_issues


# ---------------------------------------------------------------------------
# DB cross-check + plan enrichment
# ---------------------------------------------------------------------------

def _build_lookups():
    """Build in-memory lookups from DB."""
    semesters = list(Semester.objects.all())
    students_by_id = {}
    students_by_email = {}
    for s in Student.objects.select_related("section", "semester").iterator():
        students_by_id[s.student_id.casefold()] = s
        if s.email:
            students_by_email[s.email.casefold()] = s
    users_by_username, _, users_by_student = index_users()
    user_emails_cf = {
        u.email.casefold() for u in users_by_username.values() if u.email
    }
    semester_sections = {}
    for s in Semester.objects.prefetch_related("sections").all():
        semester_sections[s.pk] = list(s.sections.all())
    return (semesters, students_by_id, students_by_email, user_emails_cf,
            semester_sections, users_by_username, users_by_student)


def _compute_field_changes(existing, values, placement, semester_sections):
    """Compute field diffs for an update row."""
    changes = []

    def _diff(field_name, label, cur_val, new_val_str):
        if not new_val_str and new_val_str != 0:
            return
        cur_str = (cur_val.isoformat() if hasattr(cur_val, "isoformat")
                   else (str(cur_val) if cur_val is not None else ""))
        if str(new_val_str) != cur_str:
            changes.append({
                "field": field_name, "label": label,
                "old": cur_str, "new": str(new_val_str),
            })

    _diff("name", "Name", existing.name, values.get("name", ""))
    _diff("email", "Email", existing.email, values.get("email", ""))
    _diff("phone", "Phone", existing.phone, values.get("phone", ""))
    _diff("address", "Address", existing.address, values.get("address", ""))
    _diff("guardian_name", "Guardian Name", existing.guardian_name,
          values.get("guardian_name", ""))
    _diff("guardian_phone", "Guardian Phone", existing.guardian_phone,
          values.get("guardian_phone", ""))
    _diff("roll_no", "Roll No", existing.roll_no, values.get("roll_no", ""))

    if values.get("dob"):
        _diff("dob", "DOB", existing.dob, values["dob"])

    if values.get("admission_year") is not None:
        _diff("admission_year", "Admission Year", existing.admission_year,
              values["admission_year"])

    if values.get("status"):
        _diff("status", "Status", existing.status, values["status"])

    if placement and placement.get("semester"):
        new_sem_id = placement["semester"]["id"]
        new_sec_name = placement["section"]
        old_sem_id = existing.semester_id
        old_sec_id = existing.section_id
        new_sec_id = None
        if new_sec_name and new_sem_id:
            for s in semester_sections.get(new_sem_id, []):
                if s.name == new_sec_name:
                    new_sec_id = s.pk
                    break
        if new_sem_id != old_sem_id or new_sec_id != old_sec_id:
            old_label = (
                f"{existing.section.name if existing.section else '—'} / "
                f"{existing.semester.name if existing.semester else '—'}"
            )
            new_label = (
                f"{new_sec_name or '—'} / "
                f"{placement['semester']['name']}"
            )
            changes.append({
                "field": "placement", "label": "Program/Sec & Year/Semester",
                "old": old_label, "new": new_label,
            })
            placement["placement_change"] = True

    return changes


def enrich_row(row, values, semesters, students_by_id, students_by_email,
               user_emails_cf, semester_sections, users_by_username,
               users_by_student):
    """Enrich a row: required checks, placement, DB match, plan, severity,
    and the Phase D account consequence."""
    row["issues"] = list(row.get("issues") or [])
    row["values"] = values

    for field, code in (
        ("student_id", "missing_student_id"),
        ("name", "missing_name"),
        ("email", "missing_email"),
        ("roll_no", "missing_roll_no"),
    ):
        if not values.get(field):
            row["issues"].append(issue(
                Severity.ERROR, code,
                f'{field.replace("_", " ").title()} is required.',
            ))

    placement, placement_issues = _resolve_placement(values, semesters)
    row["issues"].extend(placement_issues)
    row["placement"] = placement

    student_id = (values.get("student_id") or "").strip()
    email = (values.get("email") or "").strip()

    existing = None
    if student_id:
        existing = students_by_id.get(student_id.casefold())

    db_match = None
    if existing:
        db_match = {"id": existing.pk, "matched_by": "student_id"}

        if email:
            email_eq_existing = (
                (existing.email or "").casefold() == email.casefold()
            )
            other_student = students_by_email.get(email.casefold())
            if other_student and other_student.pk != existing.pk:
                row["issues"].append(issue(
                    Severity.ERROR, "email_conflict",
                    f'Email "{email}" belongs to another student '
                    f'({other_student.name}).',
                ))
            elif email.casefold() in user_emails_cf and not email_eq_existing:
                row["issues"].append(issue(
                    Severity.ERROR, "email_conflict",
                    f'Email "{email}" is already in use by another account.',
                ))
    else:
        if email:
            owner = students_by_email.get(email.casefold())
            if owner:
                row["issues"].append(issue(
                    Severity.ERROR, "email_conflict",
                    f'Email "{email}" belongs to another student '
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
        linked_user = users_by_student.get(existing.pk)
    else:
        effective_status = values.get("status") or StudentStatus.ACTIVE
        linked_user = None

    account_action, account_username, account_message = compute_account_action(
        "students", values.get("student_id") or "", effective_status,
        linked_user, users_by_username,
    )

    if account_action == ACTION_CONFLICT:
        row["issues"].append(issue(
            Severity.ERROR, "username_collision",
            f'Institutional ID "{values.get("student_id", "")}" is already the '
            "login username of another account. Duplicate identities are "
            "never auto-merged.",
        ))

    row["account"] = {
        "action": account_action,
        "username": account_username,
        "role": "student",
        "must_change_password": (
            True if account_action == ACTION_PROVISION else None
        ),
        "message": account_message,
    }

    field_changes = []
    if db_match:
        existing_obj = Student.objects.select_related(
            "section", "semester"
        ).get(pk=db_match["id"])
        field_changes = _compute_field_changes(
            existing_obj, values, placement, semester_sections
        )
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
            "role": "student",
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


def build_student_summary(header_info, planned, alerts, sheet_meta,
                          empty_rows):
    summary = build_summary(
        planned, header_info, alerts, sheet_meta,
        empty_rows=empty_rows, kind="students",
    )

    plan_counts = {}
    for p in ("new", "update", "unchanged", "duplicate", "error"):
        plan_counts[p] = sum(1 for r in planned if r["plan"] == p)
    summary["plans"] = plan_counts

    summary["accounts"] = _account_counts(planned)

    summary["placement"] = {
        "changed": sum(
            1 for r in planned
            if r.get("placement", {}).get("placement_change")
        ),
        "blank": sum(
            1 for r in planned
            if any(i["code"] == "placement_blank" for i in r["issues"])
        ),
        "unresolved": sum(
            1 for r in planned
            if any(i["code"] in (
                "semester_unknown", "semester_ambiguous",
                "section_unknown", "section_ambiguous",
            ) for i in r["issues"])
        ),
        "program_tokens": sorted({
            r["placement"]["program_token"]
            for r in planned
            if r.get("placement", {}).get("program_token")
        }),
    }
    return summary


# ---------------------------------------------------------------------------
# Preview orchestrator
# ---------------------------------------------------------------------------

def prepare_student_preview(file_obj, file_name):
    """Full student preview pipeline: map → classify → enrich → summary."""
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
    mapping = map_student_headers(header_info)

    student_identity = [
        mapping[f] for f in ("student_id", "email") if f in mapping
    ]

    classify_info = dict(header_info)
    classify_info["identity_indexes"] = student_identity

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

    detect_duplicates(planned, student_identity, header_info=header_info)

    lookups = _build_lookups()
    (semesters, students_by_id, students_by_email, user_emails_cf,
     semester_sections, users_by_username, users_by_student) = lookups

    for row in planned:
        values, extract_issues = extract_values(row["normalized"], mapping)
        row["issues"].extend(extract_issues)
        enrich_row(
            row, values, semesters, students_by_id, students_by_email,
            user_emails_cf, semester_sections, users_by_username,
            users_by_student,
        )

    alerts = list(header_info["issues"])

    summary_data = build_student_summary(
        header_info, planned, alerts,
        {"sheet_name": sheet_name, "sheet_count": sheet_count},
        empty_rows=empty_count,
    )
    return planned, summary_data


# ---------------------------------------------------------------------------
# Confirm executor
# ---------------------------------------------------------------------------

def provision_student_account(profile, values):
    """Create + link a student login inside the confirmed-import transaction.

    Any constraint failure aborts the whole import (the outer
    ``transaction.atomic()`` rolls the master rows back too).
    """
    try:
        provision_account(profile, "students", values)
    except (ValidationError, IntegrityError) as exc:
        messages = getattr(exc, "messages", None) or [str(exc)]
        raise ImportRowError(
            "Account provisioning failed for "
            f'{values.get("student_id", "")}: {messages[0]}',
            "provisioning_failed",
        )


def execute_student_confirm(session):
    """Re-validate + atomic commit for a pending student import session.

    All-or-nothing: any blocking error → entire import refused (ImportRowError).
    Eligible ACTIVE rows also get their login accounts committed in the same
    transaction — never partially.
    """
    lookups = _build_lookups()
    (semesters, students_by_id, students_by_email, user_emails_cf,
     semester_sections, users_by_username, users_by_student) = lookups

    rechecked = []
    for raw_row in session.parsed_rows:
        row = dict(raw_row)
        row["issues"] = []
        enrich_row(
            row, raw_row["values"], semesters, students_by_id,
            students_by_email, user_emails_cf, semester_sections,
            users_by_username, users_by_student,
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
            "blocked_student_errors",
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
                    master = Student.objects.get(pk=row["db_match"]["id"])

            elif plan == "new":
                obj = Student(
                    student_id=values["student_id"],
                    name=values["name"],
                    email=values["email"],
                    roll_no=values["roll_no"],
                    phone=values.get("phone", ""),
                    address=values.get("address", ""),
                    guardian_name=values.get("guardian_name", ""),
                    guardian_phone=values.get("guardian_phone", ""),
                    status=values.get("status") or StudentStatus.ACTIVE,
                )
                if values.get("dob"):
                    try:
                        obj.dob = date.fromisoformat(values["dob"])
                    except ValueError:
                        pass
                if values.get("admission_year") is not None:
                    obj.admission_year = values["admission_year"]
                placement = row["placement"]
                if placement and placement.get("semester"):
                    obj.semester_id = placement["semester"]["id"]
                    sec_name = placement.get("section")
                    if sec_name:
                        for s in semester_sections.get(obj.semester_id, []):
                            if s.name == sec_name:
                                obj.section_id = s.pk
                                break
                try:
                    obj.full_clean()
                except ValidationError as exc:
                    raise ImportRowError(
                        "Row for student "
                        f'"{values.get("student_id", "")}" failed validation: '
                        + "; ".join(exc.messages),
                        "row_validation_failed",
                    ) from exc
                obj.save()
                created += 1
                master = obj

            elif plan == "update":
                existing = Student.objects.get(pk=row["db_match"]["id"])
                saved_fields = set()
                for change in row["field_changes"]:
                    fname = change["field"]
                    if fname == "placement":
                        pl = row["placement"]
                        if pl and pl.get("semester"):
                            existing.semester_id = pl["semester"]["id"]
                            saved_fields.add("semester_id")
                            sec_name = pl.get("section")
                            if sec_name:
                                for s in semester_sections.get(existing.semester_id, []):
                                    if s.name == sec_name:
                                        existing.section_id = s.pk
                                        saved_fields.add("section_id")
                                        break
                    elif fname == "dob":
                        try:
                            existing.dob = date.fromisoformat(change["new"])
                            saved_fields.add("dob")
                        except ValueError:
                            pass
                    elif hasattr(existing, fname):
                        setattr(existing, fname, change["new"])
                        saved_fields.add(fname)
                if saved_fields:
                    try:
                        existing.full_clean()
                    except ValidationError as exc:
                        raise ImportRowError(
                            "Row for student "
                            f'"{values.get("student_id", "")}" failed validation: '
                            + "; ".join(exc.messages),
                            "row_validation_failed",
                        ) from exc
                    existing.save(update_fields=sorted(saved_fields))
                    updated += 1
                else:
                    unchanged += 1
                master = existing

            if account.get("action") == ACTION_PROVISION and master is not None:
                provision_student_account(master, values)
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
