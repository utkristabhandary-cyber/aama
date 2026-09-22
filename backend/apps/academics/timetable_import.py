"""Excel student-timetable import pipeline (Phase 9).

Workflow:
    upload (.xlsx) -> extract/normalize -> match existing records -> validate
    -> preview  -> admin confirms -> transactional commit.

Safety rules implemented here:
- The importer NEVER auto-creates semesters, subjects, sections or teachers.
  Existing academic records are authoritative; unmatched values are per-row
  errors.
- Teachers are matched by institutional ``Teacher.teacher_id`` when the
  workbook supplies one (deterministic, case-insensitive exact lookup — the
  ID is authoritative and never falls back to a name). Without an ID, the
  deterministic, two-pass normalized-name lookup is used (title-stripping
  plus single-letter-initial dot normalization). There is no fuzzy/substring
  scoring, so a class can never be silently assigned to the wrong teacher.
  One match -> use it; several -> ambiguous error; none -> unresolved error.
  A supplied-but-unknown teacher ID is a hard error (never auto-creates a
  teacher, never re-matches by name). A teacher ID/name mismatch is a warning
  with the ID-resolved AAMS record kept.
- Combined-section expressions such as ``F25 (4+5+6)`` expand to their
  individual sections (``F254``/``F255``/``F256``) and create ONE timetable
  slot with all participating sections in the ``sections`` M2M. A literal
  "F25 (4+5+6)" section is never created.
- The confirm endpoint re-validates and re-matches every row against the
  current database (the client only sends the session UUID), and commits
  inside a single ``transaction.atomic`` block so a fatal failure leaves no
  partial import.
- Idempotency: an identical existing slot (same semester/day/start/teacher/
  subject/class-type/participating sections AND same end/room) is reported as
  "unchanged" and skipped. A matching slot with different fields is revised
  ("updated"). Repeatedly importing the same workbook therefore does not
  create duplicate timetable rows.

``parsed_rows`` stored on the session is the server-produced, normalized view
of the workbook (never raw client input). Confirm re-derives everything from
that normalized data, so a stale or tampered session cannot write wrong data.
"""
import datetime
import re

from django.db import transaction

from apps.academics.models import (
    Section,
    Semester,
    Subject,
    SubjectType,
    TimetableImportSession,
    TimetableSlot,
)
from apps.academics.services import (
    assert_teacher_single_module_per_semester,
    check_timetable_conflicts,
)
from apps.teachers.models import Teacher

# ---------------------------------------------------------------------------
# Limits & column vocabulary
# ---------------------------------------------------------------------------

MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_HEADER_SEARCH_ROWS = 15
MAX_DATA_ROWS = 5000
MAX_CELL_CHARS = 500

# Canonical logical field -> acceptable spreadsheet header aliases.
# Header matching is case/whitespace-insensitive (see ``header_key``).
FIELD_ALIASES = {
    "semester": [
        "semester", "sem", "term", "academic semester", "semester code",
        "semester name", "academic_semester", "year sem",
    ],
    "module_code": [
        "module code", "subject code", "code", "course code", "module no",
        "module number", "subject code.", "module code.",
    ],
    "module_title": [
        "module title", "module name", "subject", "subject name", "paper",
        "subject title", "paper title", "module", "module title.",
    ],
    # Institutional Teacher ID (Phase E) — placed BEFORE "lecturer" so its
    # exact headers ("Teacher ID", "Staff ID", ...) are claimed first instead
    # of being swallowed by the lecturer name aliases ("teacher", "faculty").
    # The bare "id" alias is intentionally excluded: a timetable workbook may
    # have an unrelated generic ID column (e.g. a row number).
    "teacher_id": [
        "teacher id", "teacher id number", "lecturer id", "instructor id",
        "staff id", "employee id", "employee code", "faculty id", "faculty code",
    ],
    "lecturer": [
        "lecturer", "teacher", "faculty", "faculty name", "instructor",
        "prof", "professor", "teacher name", "lecturer name",
    ],
    "class_type": [
        "class type", "type", "session type", "teaching type",
        "lecture/practical", "class category", "session type.",
    ],
    # Specific class_type/room labels are resolved before the greedy
    # "section" aliases ("class", "sec") so a "Class Type" / "Classroom"
    # column is never mistaken for the section column.
    "room": [
        "room", "venue", "hall", "location", "classroom", "room no",
        "room no.", "venue / room", "classroom/hall", "venue/room",
    ],
    "section": [
        "section", "class", "batch", "sec", "group", "sections",
        "section group", "section/group", "section group.", "class / section",
        "class/section",
    ],
    "day": ["day", "weekday", "day of week", "day name", "day_name"],
    "time": ["time", "session time", "period", "start - end"],
    "start_time": ["start time", "start", "from", "time start", "begin", "starts at"],
    "end_time": ["end time", "end", "to", "time end", "finish", "until"],
    "hours": ["hours", "duration", "hour", "hrs", "hr", "contact hours", "duration (hrs)"],
    "block": ["block", "building", "block no"],
    "course": ["course", "program", "course/program", "course code", "course name", "program"],
}

DAY_ALIASES = {
    "sunday": "Sunday", "sun": "Sunday",
    "monday": "Monday", "mon": "Monday",
    "tuesday": "Tuesday", "tue": "Tuesday", "tues": "Tuesday",
    "wednesday": "Wednesday", "wed": "Wednesday",
    "thursday": "Thursday", "thu": "Thursday", "thur": "Thursday", "thurs": "Thursday",
    "friday": "Friday", "fri": "Friday",
}

CLASS_TYPE_ALIASES = {
    "lecture": SubjectType.LECTURE, "lect": SubjectType.LECTURE,
    "lec": SubjectType.LECTURE, "lecturer": SubjectType.LECTURE,
    "tutorial": SubjectType.TUTORIAL, "tut": SubjectType.TUTORIAL,
    "tutorials": SubjectType.TUTORIAL,
    "practical": SubjectType.PRACTICAL, "prac": SubjectType.PRACTICAL,
    "practice": SubjectType.PRACTICAL, "lab": SubjectType.PRACTICAL,
    "laboratory": SubjectType.PRACTICAL,
}

TEACHER_TITLES = {
    "dr", "prof", "professor", "mr", "mrs", "ms", "mx", "sir", "madam",
    "mister", "miss",
}


class ImportFileError(Exception):
    """Structural error in the uploaded workbook (reject the whole import)."""

    def __init__(self, message, code="INVALID_FILE"):
        self.message = message
        self.code = code
        super().__init__(message)


class ImportRowError(Exception):
    """Value-level parsing error for a single cell/row."""

    def __init__(self, message, code="INVALID_VALUE"):
        self.message = message
        self.code = code
        super().__init__(message)


class UnresolvedValueError(ImportRowError):
    pass


class AmbiguousValueError(ImportRowError):
    pass


def issue(level, code, message):
    return {"level": level, "code": code, "message": message}


# ---------------------------------------------------------------------------
# Text & header normalization
# ---------------------------------------------------------------------------

def normalize_text(value):
    """Collapse whitespace and strip; blank becomes ''."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return ""
    text = str(value)
    return " ".join(text.split())


def header_key(value):
    """Header cell -> comparable key (lowercase, no punctuation/spaces)."""
    text = normalize_text(value).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _alias_keys(field):
    return {header_key(a) for a in FIELD_ALIASES[field]}


def map_columns(headers):
    """Map header names to canonical fields.

    Returns ``{field: idx}``. A header cell is used for at most one field.
    ``headers`` is a tuple of cell values (may be None).
    """
    # Pre-normalize every header once.
    indexed = []
    for idx, cell in enumerate(headers):
        key = header_key(cell)
        if key:
            indexed.append((idx, key))
    mapping = {}
    for field in FIELD_ALIASES:
        aliases = _alias_keys(field)
        chosen = None
        # Exact alias match first.
        for idx, key in indexed:
            if idx in mapping.values():
                continue
            if key in aliases:
                chosen = idx
                break
        if chosen is None:
            # Containment match on whole words only (robust for merged or
            # duplicated labels) so short aliases like "class"/"sec"/"to"
            # never substring-match inside unrelated names like "classroom".
            best = None
            for idx, key in indexed:
                if idx in mapping.values():
                    continue
                for alias in aliases:
                    if alias and re.search(rf"\b{re.escape(alias)}\b", key):
                        best = idx
                        break
                if best is not None:
                    break
            chosen = best
        if chosen is not None:
            mapping[field] = chosen
    return mapping


def locate_and_map_header(data_rows):
    """Find the header row and return ``(mapping, header_row_index)``.

    ``data_rows`` is the list of cell-tuples from the worksheet. The header
    row is the first row (within the first ``MAX_HEADER_SEARCH_ROWS``) whose
    mapping covers enough fields to look like a timetable header.
    """
    for row_idx in range(min(len(data_rows), MAX_HEADER_SEARCH_ROWS)):
        mapping = map_columns(data_rows[row_idx])
        mapped_count = len(mapping)
        core = (
            {"semester", "section", "day"}.issubset(set(mapping))
            and ("lecturer" in mapping or "teacher_id" in mapping)
        )
        if mapped_count >= 5 and core:
            return mapping, row_idx
    raise ImportFileError(
        "Could not locate a timetable header row. Expected columns such as "
        "Semester, Section, Day, Time, Module Code, Module Title, Lecturer or "
        "Teacher ID, Class Type, Room (Block) — at least Semester, Section, Day "
        "and a teacher column (Lecturer or Teacher ID) must be present."
    )


def _validate_required_columns(mapping):
    missing = []
    for field, group in (
        ("semester", ("semester",)),
        ("section", ("section",)),
        ("day", ("day",)),
        ("teacher", ("lecturer", "teacher_id")),
        ("module", ("module_code", "module_title")),
        ("start", ("time", "start_time")),
    ):
        if not any(f in mapping for f in group):
            missing.append(field)
    if missing:
        pretty = ", ".join(missing)
        raise ImportFileError(
            f"The spreadsheet is missing required columns: {pretty}. The "
            "importer refuses to continue with an incomplete file."
        )


# ---------------------------------------------------------------------------
# Cell value parsing
# ---------------------------------------------------------------------------

def _excel_fraction_to_time(value):
    minutes = round(float(value) * 1440)
    if minutes >= 1440:
        minutes %= 1440
    hour, minute = divmod(minutes, 60)
    return datetime.time(hour, minute)


def parse_time(value):
    """Parse a start/end time into ``datetime.time`` (24-hour)."""
    if isinstance(value, datetime.datetime):
        return value.time()
    if isinstance(value, datetime.time):
        return value
    if isinstance(value, bool):
        raise ImportRowError("Invalid time value.", "INVALID_TIME")
    if isinstance(value, (int, float)):
        # Spreadsheet-native times are a fraction of a day (0.375 == 09:00).
        if 0 < float(value) < 1:
            return _excel_fraction_to_time(value)
        raise ImportRowError("Numeric time value could not be interpreted.", "INVALID_TIME")
    text = normalize_text(value).lower()
    if not text:
        raise ImportRowError("Time value is empty.", "MISSING_TIME")

    am = None
    if text.endswith("am"):
        am, text = True, text[:-2].strip()
    elif text.endswith("pm"):
        am, text = False, text[:-2].strip()

    match = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", text)
    if not match:
        if am is not None:
            bare = re.fullmatch(r"(\d{1,2})", text)
            if bare:
                hour = int(bare.group(1))
                return _apply_ampm(hour, 0, am)
        raise ImportRowError(f'Could not parse time "{value}". Use e.g. 09:00 or 9:00 AM.', "INVALID_TIME")
    hour, minute = int(match.group(1)), int(match.group(2))
    second = int(match.group(3) or 0)
    return _apply_ampm(hour, minute, am, second=second)


def _apply_ampm(hour, minute, am, second=0):
    if am is None:
        if hour > 23 or minute > 59 or second > 59:
            raise ImportRowError("Time out of range.", "INVALID_TIME")
        return datetime.time(hour, minute, second)
    if hour < 1 or hour > 12:
        raise ImportRowError("12-hour clock hour out of range.", "INVALID_TIME")
    hour24 = hour % 12
    if not am:
        hour24 += 12
    return datetime.time(hour24, minute, second)


def parse_hours_minutes(value):
    """Parse a duration (Hours column) into minutes, or None when blank."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(round(float(value) * 60))
    text = normalize_text(value).lower()
    if not text:
        return None
    text = text.replace(".", " ") if text.endswith(".") else text
    # Pure minutes: "90 min", "45 minutes", "1h30m"-style colon durations.
    minutes_only = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes)$", text)
    if minutes_only:
        total = int(round(float(minutes_only.group(1))))
        if total <= 0:
            raise ImportRowError("Duration must be positive.", "INVALID_HOURS")
        return total
    colon = re.fullmatch(r"(\d+):(\d{1,2})", text)
    if colon:
        total = int(colon.group(1)) * 60 + int(colon.group(2))
        if total <= 0:
            raise ImportRowError("Duration must be positive.", "INVALID_HOURS")
        return total
    # "1h 30m", "1 hr 30 min"
    mixed = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)?\s*(?:(\d+)\s*(m|min|mins|minute|minutes))?", text)
    if mixed:
        hours = float(mixed.group(1) or 0)
        hrs_token = mixed.group(2)
        mins = int(mixed.group(3) or 0)
        if hrs_token is None and mins == 0:
            # bare number -> hours
            hours = float(mixed.group(1))
            mins = 0
        total = int(round(hours * 60)) + mins
        if total <= 0:
            raise ImportRowError("Duration must be positive.", "INVALID_HOURS")
        return total
    raise ImportRowError(f'Could not parse duration "{value}". Use e.g. 1.5 (hours) or "1 hr 30 min".', "INVALID_HOURS")


def parse_day(value):
    text = normalize_text(value).lower()
    if not text:
        raise ImportRowError("Day is empty.", "MISSING_DAY")
    day = DAY_ALIASES.get(text)
    if not day:
        raise ImportRowError(
            f'Unknown weekday "{value}"; expected one of Sunday..Friday.', "INVALID_DAY"
        )
    return day


def parse_class_type(value):
    text = normalize_text(value).lower()
    if not text:
        return SubjectType.LECTURE, issue(
            "warning", "CLASS_TYPE_DEFAULT",
            "Class type is blank; assumed Lecture.",
        )
    mapped = CLASS_TYPE_ALIASES.get(text)
    if not mapped:
        raise ImportRowError(
            f'Unknown class type "{value}"; expected Lecture/Tutorial/Practical.', "INVALID_CLASS_TYPE"
        )
    return mapped, None


def split_time_range(value):
    """Try to split a combined column like '09:00 - 10:00' into two parts."""
    text = normalize_text(value.lower())
    for sep in ("–", "—", "-", "to"):
        if sep in text:
            parts = [p.strip() for p in text.split(sep)]
            if len(parts) == 2:
                return parts[0], parts[1]
    return None


# ---------------------------------------------------------------------------
# Combined-section expression parsing
# ---------------------------------------------------------------------------

def expand_combined_sections(raw):
    """Parse a section expression into expanded individual section names.

    Returns ``{"is_combined": bool, "sections": [names], "error": str|None}``.
    Supports plain single sections, grouped expansions such as
    ``F25 (4+5+6)`` / ``F(1+2+3)`` -> F254/F255/F256 / F1/F2/F3, and explicit
    lists with ``+``, ``/`` or ``,`` delimiters. Ambiguous expressions are
    returned with an ``error`` (never guessed).
    """
    raw = normalize_text(raw)
    if not raw:
        return {"is_combined": False, "sections": [], "error": "Section is empty."}

    paren = re.fullmatch(r"([A-Za-z][A-Za-z0-9]*)\s*\(\s*([^()]*)\s*\)", raw)
    if paren:
        base = paren.group(1)
        members = [normalize_text(m) for m in re.split(r"[+,/]", paren.group(2)) if normalize_text(m)]
        if len(members) < 2:
            return {
                "is_combined": False,
                "sections": [],
                "error": f'Could not interpret combined-section group "{raw}".',
            }
        expanded = []
        for member in members:
            if re.fullmatch(r"\d+", member):
                expanded.append(f"{base}{member}")
            elif member.upper() == base.upper() or member.upper().startswith(base.upper()):
                expanded.append(member)
            else:
                return {
                    "is_combined": False,
                    "sections": [],
                    "error": f'Could not interpret group member "{member}" in "{raw}".',
                }
        return {"is_combined": len(expanded) > 1, "sections": _dedupe(expanded), "error": None}

    # A stray parenthesis after the base(...) form failed means the user wrote
    # a malformed group; report it as ambiguous rather than splitting blindly.
    if "(" in raw or ")" in raw:
        return {
            "is_combined": False,
            "sections": [],
            "error": f'Unrecognised combined-section syntax in "{raw}".',
        }

    for delim in ("+", "/", ","):
        if delim in raw:
            members = [normalize_text(m) for m in raw.split(delim) if m.strip()]
            if len(members) > 1:
                return {"is_combined": True, "sections": _dedupe(members), "error": None}

    return {"is_combined": False, "sections": [raw], "error": None}


def _dedupe(values):
    seen = set()
    out = []
    for value in values:
        if value not in seen:
            seen.add(value)
            out.append(value)
    return out


# ---------------------------------------------------------------------------
# Matching (backend records are authoritative; nothing is auto-created)
# ---------------------------------------------------------------------------

def teacher_key(value, strip_titles=False):
    text = normalize_text(value).lower()
    tokens = text.split()
    if strip_titles:
        tokens = [t for t in tokens if t.strip(".") not in TEACHER_TITLES]
        if not tokens:
            return ""
    normalized = []
    for token in tokens:
        token = token.strip(".")
        if len(token) == 1 and token.isalpha():
            normalized.append(token)
        else:
            normalized.append(token)
    return " ".join(normalized)


def match_semester(label):
    value = normalize_text(label)
    if not value:
        raise UnresolvedValueError(
            "Semester value is empty.", "MISSING_SEMESTER"
        )
    key = value.casefold()
    by_code = [s for s in Semester.objects.filter(code__iexact=key) if s.code.casefold() == key]
    if len(by_code) == 1:
        return by_code[0]
    if len(by_code) > 1:
        raise AmbiguousValueError(f'Semester "{value}" is ambiguous.', "AMBIGUOUS_SEMESTER")
    by_name = [s for s in Semester.objects.filter(name__iexact=key) if s.name.casefold() == key]
    if len(by_name) == 1:
        return by_name[0]
    if len(by_name) > 1:
        raise AmbiguousValueError(f'Semester "{value}" is ambiguous.', "AMBIGUOUS_SEMESTER")
    raise UnresolvedValueError(
        f'Semester "{value}" does not match any existing semester. Create it '
        "in Academic > Semesters before importing.",
        "UNKNOWN_SEMESTER",
    )


def match_teacher(label):
    value = normalize_text(label)
    if not value:
        raise UnresolvedValueError("Lecturer value is empty.", "MISSING_TEACHER")
    teachers = list(Teacher.objects.all())
    key1 = teacher_key(value, strip_titles=False)
    exact = [t for t in teachers if teacher_key(t.name, strip_titles=False) == key1]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise AmbiguousValueError(
            f'More than one teacher matches "{value}". Resolve it manually before re-importing.',
            "AMBIGUOUS_TEACHER",
        )
    key2 = teacher_key(value, strip_titles=True)
    loosened = [t for t in teachers if teacher_key(t.name, strip_titles=True) == key2]
    if len(loosened) == 1:
        return loosened[0]
    if len(loosened) > 1:
        raise AmbiguousValueError(
            f'More than one teacher matches "{value}" (after dropping titles). '
            "Resolve it manually before re-importing.",
            "AMBIGUOUS_TEACHER",
        )
    raise UnresolvedValueError(
        f'No confident match for lecturer "{value}". The importer never '
        "creates teachers automatically.",
        "UNKNOWN_TEACHER",
    )


TEACHER_ID_MAX_LENGTH = Teacher._meta.get_field("teacher_id").max_length


def resolve_teacher(supplied_id, supplied_name):
    """Resolve the teacher for a timetable row.

    A supplied institutional ``Teacher.teacher_id`` is the PRIMARY identity:
    it is matched deterministically (case-insensitive exact) and is
    authoritative — the supplied name can never re-assign the row to a
    different teacher, and an unknown ID is a hard error (no name fallback).
    Without an ID, the deterministic normalized-name lookup is used.

    Returns ``(teacher, method, warnings)`` where ``method`` is "id" or
    "name". A supplied ID+name mismatch surfaces as a warning with the
    ID-resolved AAMS record kept (mirrors the subject ``TITLE_MISMATCH``
    convention).
    """
    teacher_id = normalize_text(supplied_id)
    if teacher_id:
        if len(teacher_id) > TEACHER_ID_MAX_LENGTH:
            raise UnresolvedValueError(
                f'Teacher ID "{teacher_id}" exceeds the maximum length of '
                f"{TEACHER_ID_MAX_LENGTH} characters.",
                "TEACHER_ID_TOO_LONG",
            )
        by_id = [t for t in Teacher.objects.filter(teacher_id__iexact=teacher_id)
                 if t.teacher_id.casefold() == teacher_id.casefold()]
        if not by_id:
            raise UnresolvedValueError(
                f'Teacher ID "{teacher_id}" does not match any existing teacher. '
                "Resolve the teacher (or add the Teacher in the People section) "
                "before importing; teachers are never created automatically.",
                "UNKNOWN_TEACHER_ID",
            )
        if len(by_id) > 1:
            raise AmbiguousValueError(
                f'Teacher ID "{teacher_id}" is not unique in the database.',
                "AMBIGUOUS_TEACHER_ID",
            )
        teacher = by_id[0]
        warnings = []
        name = normalize_text(supplied_name)
        if name and teacher_key(name) != teacher_key(teacher.name):
            warnings.append(issue(
                "warning", "TEACHER_NAME_MISMATCH",
                f'Teacher ID "{teacher.teacher_id}" resolves to "{teacher.name}" '
                f'but the workbook lists lecturer "{name}". The AAMS record '
                "(matched by Teacher ID) is used.",
            ))
        return teacher, "id", warnings
    return match_teacher(supplied_name), "name", []


def match_subject(semester, code, title):
    code = normalize_text(code)
    title = normalize_text(title)
    if code:
        matches = list(Subject.objects.filter(semester=semester, code__iexact=code))
        if len(matches) != 1:
            raise UnresolvedValueError(
                f'Module code "{code}" does not match a subject in '
                f'"{semester.code}". Create the subject in Academic > Subjects '
                "before importing.",
                "UNKNOWN_SUBJECT",
            )
        subject = matches[0]
        if title and title.casefold() != subject.name.casefold():
            return subject, issue(
                "warning",
                "TITLE_MISMATCH",
                f'Module title "{title}" differs from the AAMS record '
                f'"{subject.name}" for code "{code}". The AAMS record is kept.',
            )
        return subject, None
    if title:
        matches = list(Subject.objects.filter(semester=semester, name__iexact=title))
        if len(matches) == 1:
            return matches[0], issue(
                "info", "MATCHED_BY_TITLE",
                f'Matched module by title "{title}" (no module code column value).',
            )
        if len(matches) > 1:
            raise AmbiguousValueError(
                f'Module title "{title}" matches more than one subject in '
                f'"{semester.code}". Use a Module Code instead.',
                "AMBIGUOUS_SUBJECT",
            )
        raise UnresolvedValueError(
            f'Module title "{title}" does not match a subject in '
            f'"{semester.code}". Create the subject in Academic > Subjects '
            "before importing.",
            "UNKNOWN_SUBJECT",
        )
    raise UnresolvedValueError(
        "Row has neither a Module Code nor a Module Title.", "MISSING_MODULE"
    )


def match_sections(semester, names):
    resolved, unresolved = [], []
    for name in names:
        section = Section.objects.filter(semester=semester, name__iexact=name).first()
        if section is None:
            unresolved.append(name)
        else:
            resolved.append(section)
    return resolved, unresolved


# ---------------------------------------------------------------------------
# Slot identity / classification helpers
# ---------------------------------------------------------------------------

def slot_identity_by_key(semester_id, day, start_time, teacher_id, subject_id, class_type, section_ids):
    return (
        semester_id, day, str(start_time), teacher_id, subject_id,
        class_type, tuple(sorted(int(s) for s in section_ids)),
    )


def slot_identity(semester, day, start_time, teacher, subject, class_type, section_ids):
    return slot_identity_by_key(
        semester.pk, day, start_time, teacher.pk, subject.pk, class_type, section_ids
    )


def fields_equal(end_time, room, notes, block):
    # ``block`` is folded into notes when present, so note comparison covers it.
    return {"end": str(end_time), "room": normalize_text(room), "notes": normalize_text(notes)}


def find_existing_by_identity(identity):
    sem_id, day, start, teacher_id, subject_id, class_type, section_ids = identity
    primary = section_ids[0]
    queryset = list(
        TimetableSlot.objects.filter(
            semester_id=sem_id,
            day=day,
            start_time=start,
            teacher_id=teacher_id,
            subject_id=subject_id,
            class_type=class_type,
            section_id=primary,
        )
        .prefetch_related("sections")
    )
    matches = []
    for s in queryset:
        # Single-section slots keep only the primary FK populated; the M2M is
        # set only for combined slots. Treat both consistently.
        effective = set(s.section_ids) | {s.section_id}
        if effective == set(section_ids):
            matches.append(s)
    return matches


def resolve_update_conflict(existing, incoming):
    """Return action for a matched existing slot: 'unchanged' or 'update'."""
    for slot in existing:
        if (
            str(slot.end_time) == str(incoming["end_time"])
            and normalize_text(slot.room) == normalize_text(incoming["room"])
        ):
            return "unchanged"
    return "update"


# ---------------------------------------------------------------------------
# Row extraction (pure parse; no DB access)
# ---------------------------------------------------------------------------

def extract_rows(rows, mapping, header_row_index):
    """Normalize every data row into the stored per-row JSON shape."""
    data = []
    for idx, cells in enumerate(rows[header_row_index + 1 :]):
        if len(data) >= MAX_DATA_ROWS:
            break

        def cell(field):
            col = mapping.get(field)
            if col is None or col >= len(cells):
                return None
            return cells[col]

        values = {}
        issues = []

        def set_value(key, field):
            raw = cell(field)
            if raw is None or isinstance(raw, bool):
                values[key] = ""
            elif isinstance(raw, datetime.datetime):
                values[key] = raw.isoformat()
            elif isinstance(raw, datetime.time):
                values[key] = raw.strftime("%H:%M")
            elif isinstance(raw, float) and raw.is_integer():
                # Excel often yields numeric integral staff IDs as floats
                # (e.g. 4471.0); render them without the decimal part.
                values[key] = str(int(raw))
            elif isinstance(raw, (int, float)):
                values[key] = str(raw)
            else:
                text = normalize_text(raw)
                values[key] = text[:MAX_CELL_CHARS]

        for key in ("semester", "module_code", "module_title", "teacher_id", "lecturer"):
            set_value(key, key)
        set_value("section_raw", "section")
        set_value("class_type", "class_type")
        set_value("room", "room")
        set_value("course", "course")
        set_value("block", "block")
        set_value("time", "time")
        set_value("start_raw", "start_time")
        set_value("end_raw", "end_time")
        set_value("hours_raw", "hours")

        # Skip fully-empty rows.
        if not any(values.get(k, "") for k in (
            "semester", "module_code", "module_title", "teacher_id", "lecturer",
            "section_raw", "room", "course", "block", "time", "start_raw",
            "hours_raw",
        )):
            continue

        row = {
            "row": header_row_index + 2 + idx,
            "raw": dict(values),
            "semester": values["semester"],
            "semester_label": values["semester"],
            "module_code": values["module_code"],
            "module_title": values["module_title"],
            "teacher_id": values["teacher_id"],
            "lecturer": values["lecturer"],
            "section_raw": values["section_raw"],
            "course": values["course"],
            "room": values["room"],
            "block": values["block"],
            "day": "",
            "start_time": "",
            "end_time": "",
            "hours_minutes": None,
            "class_type": "",
            "sections_expanded": [],
            "is_combined": False,
            "issues": [],
        }

        # Day
        try:
            row["day"] = parse_day(cell("day"))
        except ImportRowError as exc:
            issues.append(issue("error", getattr(exc, "code", "INVALID_DAY"), exc.message))

        # Class type
        try:
            parsed_type, warning = parse_class_type(values["class_type"])
            row["class_type"] = parsed_type
            if warning:
                issues.append(warning)
        except ImportRowError as exc:
            issues.append(issue("error", getattr(exc, "code", "INVALID_CLASS_TYPE"), exc.message))

        # Start / end / duration
        start_hint = values["start_raw"] or values["time"]
        end_hint = values["end_raw"]
        if not end_hint and values["time"] and not start_hint:
            range_split = split_time_range(values["time"])
            if range_split:
                start_hint, end_hint = range_split
        try:
            if start_hint:
                row["start_time"] = parse_time(start_hint).strftime("%H:%M:%S")
        except ImportRowError as exc:
            issues.append(issue("error", getattr(exc, "code", "INVALID_TIME"), f"Start {exc.message}"))

        try:
            parsed_end = None
            if end_hint:
                parsed_end = parse_time(end_hint)
            else:
                minutes = parse_hours_minutes(values["hours_raw"])
                if minutes is not None:
                    row["hours_minutes"] = minutes
                    if row["start_time"]:
                        from datetime import timedelta
                        base = datetime.datetime.combine(datetime.date.today(), datetime.time.fromisoformat(row["start_time"]))
                        parsed_end = (base + timedelta(minutes=minutes)).time()
            if parsed_end is not None:
                row["end_time"] = parsed_end.strftime("%H:%M:%S")
        except ImportRowError as exc:
            issues.append(issue("error", getattr(exc, "code", "INVALID_HOURS"), f"End {exc.message}"))

        if row["start_time"] and not row["end_time"]:
            issues.append(issue(
                "error", "MISSING_END",
                "Row has a start time but no end time or duration (Hours).",
            ))
        if row["start_time"] and row["end_time"] and row["end_time"] <= row["start_time"]:
            issues.append(issue(
                "error", "INVALID_TIME_RANGE",
                f"End {row['end_time']} must be after start {row['start_time']}.",
            ))
        if row["hours_minutes"] and row["start_time"] and row["end_time"]:
            # Duration and explicit end both present -> explicit end wins; inform.
            issues.append(issue(
                "info", "END_TIME_WINS",
                "Both End Time and Hours are provided; the explicit End Time is used.",
            ))
        if not row["start_time"]:
            missing = "a start time (Time / Start Time) or parseable time range"
            issues.append(issue("error", "MISSING_START", f"Row is missing {missing}."))

        row["issues"] = issues
        data.append(row)
    return data


# ---------------------------------------------------------------------------
# Planning (DB matching + validation + classification)
# ---------------------------------------------------------------------------

def plan_rows(rows):
    """Validate & classify normalized rows against the current database."""
    planned = []
    seen_identities = {}

    unresolved = {"semesters": [], "sections": [], "subjects": [], "teachers": []}
    conflict_count = 0

    for row in rows:
        resolved = {
            "semester": None, "sections": [], "subject": None, "teacher": None,
        }
        plan = None
        issues = list(row.get("issues") or [])

        def add_unresolved(bucket, label):
            if label and label not in unresolved[bucket]:
                unresolved[bucket].append(label)

        # For display we keep the extraction issues separate.
        out = dict(row)
        out["issues"] = issues

        # 1. Semester
        try:
            semester = match_semester(out["semester_label"])
            resolved["semester"] = semester
            out["semester"] = {"id": semester.pk, "code": semester.code, "name": semester.name}
        except ImportRowError as exc:
            add_unresolved("semesters", out["semester_label"])
            issues.append(issue("error", exc.code, exc.message))
            out["semester"] = None

        semester = resolved["semester"]
        section_ids = []
        if semester is not None:
            # 2. Sections
            expansion = expand_combined_sections(out["section_raw"])
            if expansion["error"]:
                issues.append(issue("error", "AMBIGUOUS_SECTION", expansion["error"]))
            else:
                names = expansion["sections"]
                out["sections_expanded"] = names
                out["is_combined"] = expansion["is_combined"]
                matched, missing = match_sections(semester, names)
                if missing:
                    for name in missing:
                        add_unresolved("sections", f"{name} ({semester.code})")
                    issues.append(issue(
                        "error", "UNKNOWN_SECTION",
                        f'No matching section{"s" if len(missing) > 1 else ""} '
                        f'in "{semester.code}": {", ".join(missing)}.',
                    ))
                resolved["sections"] = matched
                if matched:
                    section_ids = [s.pk for s in matched]
                    out["sections"] = [{"id": s.pk, "name": s.name} for s in matched]

            # 3. Subject
            try:
                subject, match_warning = match_subject(
                    semester, out["module_code"], out["module_title"]
                )
                resolved["subject"] = subject
                out["subject"] = {"id": subject.pk, "code": subject.code, "name": subject.name}
                if match_warning and match_warning["level"] in ("warning", "error"):
                    issues.append(match_warning)
            except ImportRowError as exc:
                add_unresolved("subjects", out["module_code"] or out["module_title"])
                issues.append(issue("error", exc.code, exc.message))
                out["subject"] = None

            # 4. Teacher (Teacher ID is primary; name is fallback only)
            try:
                teacher, tmethod, teacher_warnings = resolve_teacher(
                    out.get("teacher_id", ""), out["lecturer"]
                )
                resolved["teacher"] = teacher
                issues.extend(teacher_warnings)
                out["teacher"] = {
                    "id": teacher.pk,
                    "teacher_id": teacher.teacher_id,
                    "name": teacher.name,
                    "match_method": tmethod,
                    "supplied_id": out.get("teacher_id") or None,
                    "supplied_name": out["lecturer"] or None,
                }
            except ImportRowError as exc:
                add_unresolved("teachers", out.get("teacher_id") or out["lecturer"])
                issues.append(issue("error", exc.code, exc.message))
                out["teacher"] = None

        has_parse_error = any(i["level"] == "error" for i in issues)
        commit_shape_ok = (
            out["semester"] and resolved["sections"] and resolved["subject"]
            and resolved["teacher"] and out["day"] and out["start_time"] and out["end_time"]
        )

        if not has_parse_error and commit_shape_ok:
            identity = slot_identity(
                semester, out["day"], out["start_time"], resolved["teacher"],
                resolved["subject"], out["class_type"], section_ids,
            )
            existing = find_existing_by_identity(identity)

            if len(existing) > 1:
                issues.append(issue(
                    "error", "DUPLICATE_EXISTING",
                    "More than one existing timetable row has this exact identity. "
                    "Resolve the duplicates in the timetable first.",
                ))
            elif identity in seen_identities:
                plan = "duplicate"
                issues.append(issue(
                    "info", "DUPLICATE_ROW",
                    f"Identical to row {seen_identities[identity]}; skipped to avoid a duplicate slot.",
                ))
            elif existing and resolve_update_conflict(existing, out) == "unchanged":
                plan = "unchanged"
                issues.append(issue(
                    "info", "UNCHANGED",
                    "An identical timetable slot already exists; no change needed.",
                ))
            elif existing:
                plan = "update"
                issues.append(issue(
                    "info", "WILL_UPDATE",
                    f"Will update existing slot (end/venue change).",
                ))
            else:
                plan = "new"

            # Conflicts only make sense for rows we would create/update.
            if plan in ("new", "update"):
                conflict_reason = check_timetable_conflicts(
                    semester=semester,
                    teacher=resolved["teacher"],
                    section=resolved["sections"][0],
                    section_ids=section_ids,
                    day=out["day"],
                    start_time=out["start_time"],
                    end_time=out["end_time"],
                    room=out["room"],
                    class_type=out["class_type"],
                    exclude_slot_id=existing[0].pk if (plan == "update" and existing) else None,
                )
                if conflict_reason:
                    conflict_count += 1
                    issues.append(issue("error", "CONFLICT", conflict_reason))
                try:
                    assert_teacher_single_module_per_semester(
                        resolved["teacher"], resolved["subject"], semester,
                        exclude_timetable_slot_id=existing[0].pk if (plan == "update" and existing) else None,
                    )
                except Exception as exc:
                    issues.append(issue(
                        "error", "TEACHER_MODULE_RULE",
                        ", ".join(exc.messages) if hasattr(exc, "messages") else str(exc),
                    ))

            if identity in seen_identities:
                plan = "duplicate"  # keep duplicate classification dominant
            seen_identities.setdefault(identity, out["row"])

        if plan is None and not any(i["level"] == "error" for i in issues):
            plan = "new"
        if plan is None:
            plan = "error"

        out["plan"] = plan
        out["status"] = classify_status(plan, issues)
        planned.append(out)
    return planned, summarize(planned, unresolved, conflict_count)


def classify_status(plan, issues):
    if any(i["level"] == "error" for i in issues):
        return "error"
    if plan == "duplicate":
        return "duplicate"
    if plan == "unchanged":
        return "unchanged"
    if plan == "update":
        return "warning" if any(i["level"] == "warning" for i in issues) else "update"
    return "warning" if any(i["level"] == "warning" for i in issues) else "valid"


def summarize(planned, unresolved, conflict_count):
    counts = {
        "total_rows": len(planned),
        "valid_rows": 0, "warning_rows": 0, "error_rows": 0,
        "duplicate_rows": 0, "unchanged_rows": 0,
        "new_rows": 0, "updated_rows": 0, "combined_rows": 0,
        "conflict_rows": conflict_count,
    }
    labels = {
        "new": "new_rows", "update": "updated_rows", "duplicate": "duplicate_rows",
        "unchanged": "unchanged_rows",
    }
    for row in planned:
        if row["status"] == "error":
            counts["error_rows"] += 1
        elif row["status"] == "duplicate":
            counts["duplicate_rows"] += 1
        elif row["status"] == "unchanged":
            counts["unchanged_rows"] += 1
        elif row["plan"] in ("new", "update"):
            if row["status"] == "warning":
                counts["warning_rows"] += 1
            else:
                counts["valid_rows"] += 1
            counts[labels[row["plan"]]] += 1
        else:
            counts["valid_rows"] += 1
            counts["new_rows"] += 1
        if row.get("is_combined") and row["status"] not in ("error", "duplicate"):
            counts["combined_rows"] += 1
    counts["commit_rows"] = counts["new_rows"] + counts["updated_rows"]
    return {"counts": counts, "unresolved": unresolved}


# ---------------------------------------------------------------------------
# Excel loading
# ---------------------------------------------------------------------------

def load_workbook_sheet(file_obj, file_name):
    """Read the first worksheet into a bounded list of cell tuples."""
    import openpyxl

    lowered = file_name.lower()
    if not lowered.endswith(".xlsx"):
        if lowered.endswith(".xls"):
            raise ImportFileError(
                "Legacy .xls workbooks are not supported. Save the timetable "
                "as .xlsx and try again."
            )
        raise ImportFileError(
            f"Unsupported file type \"{file_name}\". Only Excel .xlsx workbooks "
            "are accepted."
        )
    if file_obj.size > MAX_FILE_BYTES:
        raise ImportFileError(
            f"File is {file_obj.size} bytes but the maximum allowed is "
            f"{MAX_FILE_BYTES} bytes (5 MB)."
        )
    try:
        workbook = openpyxl.load_workbook(
            file_obj, read_only=True, data_only=True
        )
    except Exception as exc:
        raise ImportFileError(
            "The uploaded file is not a readable Excel workbook."
        ) from exc
    try:
        sheet = workbook.worksheets[0]
        rows = []
        bounds = sheet.max_row or 0
        for row in sheet.iter_rows(values_only=True):
            rows.append(row)
            if len(rows) > MAX_HEADER_SEARCH_ROWS + MAX_DATA_ROWS:
                break
        return rows, sheet.title
    finally:
        workbook.close()


# ---------------------------------------------------------------------------
# Public API: preview & commit
# ---------------------------------------------------------------------------

def _row_has_content(cells):
    """True when any cell holds more than whitespace (mirrors classifier).

    Kept local to this module to avoid a circular import with the generic
    engine's classifier (which itself imports this module's normalizer).
    """
    for cell in cells:
        if cell is None or isinstance(cell, bool):
            continue
        if "".join(str(cell).split()):
            return True
    return False


def prepare_preview(file_obj, file_name):
    rows, sheet_name = load_workbook_sheet(file_obj, file_name)
    mapping, header_row = locate_and_map_header(rows)
    _validate_required_columns(mapping)
    data_cells = rows[header_row + 1:]
    meaningful = sum(1 for cells in data_cells if _row_has_content(cells))
    if meaningful > MAX_DATA_ROWS:
        raise ImportFileError(
            f"The first worksheet has {meaningful} data rows, but the maximum "
            f"supported is {MAX_DATA_ROWS} rows.",
            "file_too_many_rows",
        )
    normalized = extract_rows(rows, mapping, header_row)
    if not normalized:
        raise ImportFileError(
            "The workbook contains no timetable rows after the header row."
        )
    planned, summary = plan_rows(normalized)
    return planned, summary, {"sheet_name": sheet_name, "sheet_count": 1}


def execute_confirm(session):
    """Re-validate and commit a pending import session (transactional)."""
    planned, bare_summary = plan_rows(session.parsed_rows)
    counts = bare_summary["counts"]

    # All-or-nothing: if any row now fails validation (e.g. the teacher
    # became unknown/invalid since preview), refuse the whole commit. Nothing
    # is written and the session stays pending for inspection.
    blocking = [r for r in planned if r["status"] == "error"]
    if blocking:
        codes = {}
        for r in blocking:
            for item in r.get("issues", []):
                if item.get("level") == "error":
                    codes[item["code"]] = codes.get(item["code"], 0) + 1
        parts = [f"{code} ({n})" for code, n in sorted(codes.items())]
        raise ImportRowError(
            f"Import blocked: {len(blocking)} row(s) now fail validation "
            f"[{', '.join(parts)}]. No timetable rows were written. Fix the "
            "rows in the workbook and re-upload, or delete the pending session.",
            "blocked_timetable_errors",
        )

    commit_rows = [r for r in planned if r["plan"] in ("new", "update")]

    created_count = updated_count = 0
    combined_count = 0
    with transaction.atomic():
        for row in commit_rows:
            try:
                if row["plan"] == "update":
                    identity = slot_identity_by_key(
                        row["semester"]["id"], row["day"], row["start_time"],
                        row["teacher"]["id"], row["subject"]["id"],
                        row["class_type"], [s["id"] for s in row["sections"]],
                    )
                    existing = find_existing_by_identity(identity)
                    if not existing:
                        # The slot vanished between preview and confirm -> create.
                        create_slot_from_row(row)
                        created_count += 1
                        combined_count += int(row.get("is_combined", False))
                        continue
                    slot = existing[0]
                    slot.end_time = row["end_time"]
                    slot.room = row["room"]
                    slot.notes = build_notes(row)
                    slot.save(update_fields=["end_time", "room", "notes"])
                    updated_count += 1
                    combined_count += int(row.get("is_combined", False))
                    continue
                create_slot_from_row(row)
                created_count += 1
                combined_count += int(row.get("is_combined", False))
            except Exception:
                # A genuine DB error mid-batch aborts the whole transaction,
                # leaving the database untouched.
                raise

    from django.utils import timezone

    session.status = TimetableImportSession.Status.CONFIRMED
    session.confirmed_at = timezone.now()
    session.summary = {
        "counts": {
            **counts,
            "created_rows": created_count,
            "updated_rows": updated_count,
            "commit_rows": created_count + updated_count,
        },
        "unresolved": bare_summary["unresolved"],
        "combined_rows": combined_count,
    }
    session.save(update_fields=["status", "confirmed_at", "summary"])
    return planned, session.summary


def create_slot_from_row(row):
    target = [s["id"] for s in row["sections"]]
    primary_id = target[0]
    slot = TimetableSlot.objects.create(
        semester_id=row["semester"]["id"],
        section_id=primary_id,
        subject_id=row["subject"]["id"],
        teacher_id=row["teacher"]["id"],
        day=row["day"],
        start_time=row["start_time"],
        end_time=row["end_time"],
        room=row["room"],
        class_type=row["class_type"],
        notes=build_notes(row),
        is_combined=len(target) > 1,
    )
    if len(target) > 1:
        slot.sections.set(Section.objects.filter(pk__in=target))
    return slot


def build_notes(row):
    parts = []
    if row.get("block"):
        parts.append(f"Block: {row['block']}")
    parts.extend(extract_original_notes(row))
    return " | ".join(p for p in parts if p)


def extract_original_notes(row):
    notes = []
    # Raw import session stores the display values; original notes may exist
    # as a preserved field in later iterations. Nothing extra today.
    return notes