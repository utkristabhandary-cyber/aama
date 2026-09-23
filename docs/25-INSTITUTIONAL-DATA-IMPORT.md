# AAMS — Institutional Data Import: Architecture & Business-Rule Audit

Status: **DESIGN ONLY (read-only audit); PHASES A, B, C & D COMPLETE** —
no production student/teacher/account data mutation exists without an explicit
admin confirmation (upload only stages a plan; only the confirmed atomic step
writes).
Scope: Students, Teachers, and Timetable/teaching-assignment onboarding via
institutional Excel workbooks.
Decision label key used throughout:

- **ALREADY EXISTS** — present and working in the codebase today.
- **NEEDS CHANGE** — an existing component must be adjusted.
- **NEW FEATURE** — must be built.
- **CANNOT FINALIZE UNTIL REAL EXCEL IS PROVIDED** — the institutional workbook
  (columns, sheet layout, actual IDs) is required before this can be locked.

---

## Golden Rules (apply to every design below)

1. **UPLOAD ≠ IMPORT.** Uploading a workbook must never create or mutate a
   student, teacher, account, attendance, or academic record. Only the final,
   explicitly-confirmed step may write.
2. **The server is the sole source of truth.** The server parses, validates,
   stores the normalized plan, and re-validates on confirmation. The browser
   never submits "the corrected rows"; it submits only the server-issued
   `session.uuid`.
3. **Transactional and idempotent.** A confirmed session commits atomically and
   deterministically; re-running the same workbook produces `unchanged` rows,
   never duplicates or silent password resets.
4. **Master data and assignments never mix.** The Teacher workbook owns teacher
   master data; the Timetable workbook owns academic assignments. A timetable
   import must never overwrite teacher personal data, and a teacher import must
   never create assignments.
5. **No silent damage.** Missing/ambiguous references are `ERROR`/`SUSPICIOUS`
   that block confirmation; the system never guesses, auto-creates academic
   entities, or merges conflicting identities.

---

## 0. Source-of-Truth & Demo-Boundary Status (Phase G)

Golden Rule 2 ("the server is the sole source of truth") is now enforced
**client-side as well**. Phase G deleted the frontend localStorage mock store
and removed every fabricated/demo fallback:

- **Deleted:** `src/services/storage.ts`, `src/services/promotionService.ts`,
  `src/services/academicRules.ts`, `src/data/initialData.ts`, and the
  `PromotionRecord` type. The frontend has **no localStorage data store** — the
  only browser storage left is the auth session token
  (`sessionStorage["aams_auth_token"]`).
- **Wired to live DRF data:** global search (role-scoped, admin/teacher/student),
  section-allocation CSV preview + apply (student `PATCH`, incl. `null`
  unallocations), promotion rosters (live cohorts + server-computed attendance).
- **Made honestly read-only (no fake writes where no backend feature exists):**
  promotion execution (disabled + explanatory banner; student `semester` is
  server-managed/read-only), settings (institution/term/policy read-only — no
  settings API), profile branding & academic year (derived from live semester),
  teacher students view (no storage listener; real roster; no fabricated 100%).
- **Policy regression gates (all green):** `tsc --noEmit`, `vite build`, Vitest
  (59 tests, incl. new section-allocation preview/apply + partial-failure
  coverage), Django test suite (391), `makemigrations --check --dry-run`, and
  browser E2E across admin/teacher/student confirming zero demo data and no
  console errors from storage listeners.
- See `docs/23-IMPLEMENTATION-GAPS.md` for the genuine server-side gaps that
  must NOT be simulated (promotion API, settings API, bulk section-allocation
  transaction).

---

## 1. Current Architecture — Import-Relevant

> **ALREADY EXISTS**, with an import-shaped skeleton to generalize.

- **Stack:** Django 5.2.17 + DRF 3.18.0, PostgreSQL 16, openpyxl 3.1.5,
  django-cors-headers, django-filter, python-dotenv, Pillow. Frontend: React 19
  + Vite + TypeScript + Tailwind.
- **8 backend apps:** `accounts`, `academics`, `teachers`, `students`,
  `attendance`, `reports`, `notifications`, `common`.
- **One complete import pipeline exists:** institutional Timetable workbook
  upload → server parse/preview → admin verification → confirmation →
  transactional commit, driven by `apps/academics/timetable_import.py` +
  `TimetableImportViewSet` (`views.py:202`, `IsAdminUser`) and the live 3-step
  frontend wizard. Students and teachers only have admin CRUD
  (`StudentsView.tsx`, `TeachersView.tsx`, API-backed); **no import exists for
  either**.

Reusable primitives in `timetable_import.py` (proven by 54 backend tests) worth
generalizing: severity model (VALID/WARNING/SUSPICIOUS/ERROR in spirit),
header normalization + alias lookup, `ImportFileError`, server-produced
`parsed_rows`, owner-scoped history, `transaction.atomic()` confirm,
deterministic identity matching, and the enforcement constants
`MAX_FILE_BYTES = 5 MB` (`timetable_import.py:57`), `MAX_DATA_ROWS = 5000`,
`MAX_CELL_CHARS = 500`.

---

## 2. Authentication System

> **ALREADY EXISTS** end-to-end; **NEEDS CHANGE** to support first-login
> flows for provisioned accounts.

- **Login:** `POST /api/auth/login/` (username + password) → returns an
  `ExpiringToken` (`accounts/models.py`), TTL from `AAMS_TOKEN_TTL_SECONDS`
  (default 2592000 s ≈ 30 days); throttled (per-account + burst).
- **Auth backend:** `ExpiringTokenAuthentication`
  (`accounts/authentication.py`) — `Authorization: Token <key>`; 401 on
  invalid/expired/inactive; expired tokens are deleted.
- **Identity model:** `accounts.User(AbstractUser)` with `role`
  (admin/teacher/student), `email` (unique), `name`, and OneToOne links
  `teacher_profile` / `student_profile`. `username` is the unique login handle.
- **`/me` endpoints:** `/api/auth/me/`, `/api/students/me/`,
  `/api/teachers/me/` — server-derived identity; the client never supplies an
  explicit user id for scoped endpoints.
- **Known gaps to design around:** no password change, no password reset, and
  no forced-first-login-password-change mechanism exist anywhere (backend or
  frontend — verified by search). There is also no link between
  `User.is_active` and `Student.status`. See §16.

---

## 3. Student Model

> **ALREADY EXISTS**; a few fields are candidates for the master import.

`apps/students/models.py`:

| Field | Notes |
|---|---|
| `student_id` | unique, max 30 — **primary import identity** |
| `roll_no` | max 30 |
| `name` | required |
| `email` | **unique** |
| `phone` | optional |
| `section` FK, `semester` FK | `clean()` enforces section↔semester consistency |
| `admission_year` | optional |
| `dob`, `address`, `guardian_name`, `guardian_phone` | optional |
| `avatar` | optional |
| `status` | active / graduated / inactive |

Import responsibilities: populate these fields from the mapped columns and
create the `Student` row; **never** auto-create `Semester`/`Section`.

---

## 4. Teacher Model

> **ALREADY EXISTS**; the master-import target.

`apps/teachers/models.py`:

| Field | Notes |
|---|---|
| `teacher_id` | unique, max 30 — **primary import identity** |
| `name` | required |
| `email` | **unique** |
| `phone` | optional |
| `department`, `designation`, `qualification` | free-text |
| `avatar` | optional |
| `status` | active / inactive |

The teacher import owns **master data only** (identity, contact, designation,
qualification, status). Teaching assignments are owned by the academics module
(§5) and created via `AssignmentsView` / `TeacherAssignment` — **NOT** by this
import. Mapping of the real workbook's columns to these fields is in §27.

---

## 5. Timetable Model

> **ALREADY EXISTS** (Phase B.5/B.6/B.6-F complete, per `docs/14`).

- `Semester`, `Section`, `Subject`, `TeacherAssignment`
  (semester+subject+section+teacher, active/draft status), `TimetableSlot`
  (day `start_time`/`end_time`/`room`/`class_type`/`notes`, sections M2M for
  combined classes), `TeachingSession`, `Holiday`, and the import session model.
- Combined-section expressions (e.g. `F25 (4+5+6)`) expand into one slot with
  multiple sections — an existing, tested behavior to keep.
- Idempotency semantics already live: identical existing slot → `unchanged`;
  same slot with different fields → `updated`.

---

## 6. Import Architecture (Existing Timetable Importer)

> **ALREADY EXISTS** and the reference architecture to mirror.

Live pipeline (`apps/academics/timetable_import.py`,
`TimetableImportViewSet` `views.py:202`):

1. **Upload** (`POST .../timetable-import/preview/`): server parses the
   workbook (`.xlsx` only), validates headers, normalizes rows, matches against
   the DB, and stores a server-produced `parsed_rows` + `summary` on a
   `TimetableImportSession` (`models.py:299`; fields: `uuid`, `created_by`,
   `file_name`, `file_size`, `sheet_name`, `sheet_count`, `total_rows`,
   `parsed_rows`, `summary`, `status` pending/confirmed, `created_at`,
   `confirmed_at`). **No authoritative rows are touched.**
2. **Verify** (`GET .../timetable-import/<uuid>/` + history list): the admin
   reviews classified rows/severities.
3. **Confirm** (`POST .../timetable-import/confirm/`): the server re-parses /
   re-matches / re-validates from the stored session (client sends only the
   `session_uuid`), commits inside `transaction.atomic()`, and only then flips
   the session to `CONFIRMED`.
4. **History/scoping:** list and confirm are scoped to the importing
   (`created_by`) admin; a confirmed session cannot be re-confirmed.

Constraints enforced: teacher match by deterministic normalized-name matching
(two-pass, no fuzzy scoring) — one match → use; several → ambiguous error;
none → unresolved error; unknown semester/section/subject/teacher → row error;
never auto-creates academic entities.

**NEEDS CHANGE** — see §18 (add institutional teacher-ID matching) and §21
(record/store generalized audit shape). Otherwise this pipeline is the template.

---

## 7. Admin Permissions

> **ALREADY EXISTS**; no changes required beyond reusing the same classes.

`apps/accounts/permissions.py`: `IsAdminUser`, `IsTeacherUser`,
`IsStudentUser`, `IsAdminOrTeacher`, `AdminOrReadOnly`, `AdminOrTeacherRead`,
`ReadOnly`. Academic write/CUD routes use `AdminOrReadOnly`; import routes use
`IsAdminUser` (import tests already assert unauth → 401, teacher → 403,
admin → 200). **All student/teacher/timetable import endpoints must be
`IsAdminUser`** — matching the existing importer.

---

## 8. Password System

> **ALREADY EXISTS** (storage hashing, validators); **NEW FEATURE** is needed
> for the full lifecycle.

- **Storage:** Django default `PBKDF2` via `set_password()` + `check_password()`
  (see `docs/20-SECURITY-AUDIT.md`). Passwords are never stored/transmitted in
  plaintext.
- **Validators** (`config/settings/base.py`): MinimumLength, CommonPassword,
  NumericPassword — applied on form/serializer `validate_password`, **not**
  enforced by `set_password` (so initial temp passwords bypass validation by
  design; the change-password endpoint enforces them, see §16).
- **Lifecycle (implemented in Phase D, §28):** `POST /api/auth/password/change/`
  (self-service, full validator enforcement, token rotation, clears the flag),
  `POST /api/auth/password/reset/` (admin-only, re-applies the bootstrap
  lifecycle), `User.must_change_password` (BooleanField, default `False`),
  and the first-login gate surfaced by `/api/auth/me/` (§16).

---

## 9. Proposed Import Lifecycle (Students & Teachers)

> Design — **NEW FEATURE** (mirrors the proven timetable flow, extended to
> account provisioning).

```
1. UPLOAD               → POST /import/<kind>/preview/   (admin, file)
2. SYSTEM CHECK         → server: workbook schema + header validation
3. DATA QUALITY         → server: per-cell extraction, normalization,
                          severity classification (VALID/WARNING/SUSPICIOUS/ERROR)
4. DATABASE CROSS-CHECK → server: identity + email + status matching
                          (new / update / unchanged / duplicate / conflict)
5. ADMIN VERIFICATION   → GET preview payload; resolve SUSPICIOUS/ERROR rows
                          (no client side-channels)
6. EXPLICIT CONFIRMATION→ POST confirm/ {session_uuid}  (re-validates server-side)
7. TRANSACTIONAL IMPORT → atomic commit of people + profiles (§20)
8. ACCOUNT PROVISIONING→ create User/login for eligible new people (§14)
9. AUDIT RESULT         → confirmed immutable session + history (§21)
```

`kind ∈ {students, teachers}`, each with its own viewset/session (§23).

---

## 10. System Check Architecture

> **NEW FEATURE** (server-side engine; existing timetable code is the template).

- **Workbook gate:** `.xlsx` only (legacy `.xls`/unknown/corrupt rejected),
  5 MB max, first worksheet, `MAX_DATA_ROWS`/`MAX_CELL_CHARS` limits — reuse
  existing constants/semantics from `timetable_import.py`.
- **Header layer:** normalize text + alias map (e.g. `user_email`, `e-mail`,
  `Email`) → canonical field; unrecognized-but-mapable columns → tentative map;
  unrecognized/unmapped columns → `WARNING` (documented-ignored) so a silently
  dropped column is visible. Duplicate/ambiguous normalized headers → `ERROR`.
- **Extraction/normalization layer (server-side only):** trim, collapse
  whitespace, canonicalize DOB (A.D./B.S.), phone/email casing, numeric roll.
  The normalized value is what the admin sees in preview. The Excel cell is
  never written to the DB verbatim.
- **Severity layer:** `VALID` | `WARNING` | `SUSPICIOUS` | `ERROR` per cell and
  per row (§11). Aggregated `summary` counts, plus classified row views.
- **Deterministic ordering:** the same bytes always produce the same plan
  (idempotency tests rely on this).

---

## 11. Data Quality & Suspicious Rules

> **NEW FEATURE.** `SUSPICIOUS ≠ ERROR`: suspicious rows block nothing but are
> surfaced for review; errors block confirmation.

Representative rule catalog (per-field thresholds/checks to finalize with the
real workbook — §27):

- **Required missing** → `ERROR` (identity columns, name, email when used).
- **Format problems** → `SUSPICIOUS`: malformed email, non-numeric roll/phone,
  improbable DOB (e.g. >18yo for new adm, future date), inconsistent
  A.D.↔B.S. pair, blank-but-expected parent field.
- **Cross-field inconsistency** → `SUSPICIOUS`/`ERROR`: semester vs section
  mismatch (must respect `Student.clean()`), admission year vs semester drift.
- **Duplicates within workbook** (same `student_id`, same email) → `ERROR` on
  the later rows.
- **Cross-table identity conflicts** → `ERROR`: `student_id` already a teacher
  ID, email already used by a different person (student/teacher/user).
- **Unmapped source columns** → `WARNING` (ignored, listed).
- **Weak default passwords** → `WARNING` banner (not per-row).

**Confirm-time error contract.** Validation is re-derived server-side at
confirm (the client never pre-empts it), so confirm failures carry stable
`code` values the UI can branch on:

- `file_too_many_rows` — the first worksheet holds more than `MAX_DATA_ROWS`
  (5000) meaningful data rows; the upload is rejected before planning.
- `row_validation_failed` — a row passes the loose preview regexes but fails
  Django model/field validation at commit (e.g. `alice@example..com` passes
  the preview email regex yet is rejected by the email validator). Nothing is
  written and the session stays `PENDING`.
- `session_uuid_invalid` — `session_uuid` is not a well-formed UUID.
- `session_uuid_required`, `session_not_found`, `already_confirmed`.

**Concurrency.** The confirm endpoint locks the session row with
`select_for_update()` inside `transaction.atomic()` and re-checks status under
the lock, so two simultaneous confirms of the same session serialize: exactly
one commits, the loser returns 400 `already_confirmed` (no duplicate rows).

---

## 12. Admin Verification Design

> **NEW FEATURE** UI/behavior; reuses timetable wizard patterns.

- Preview payload exposes per-row: Excel row number / source row, canonical
  identifier, field, severity, current (DB) vs expected (workbook) value, and a
  recommended action (create / update fields / skip-unchanged).
- Classified views/filters: All | Valid | Warnings | Suspicious | Errors |
  New | Updates | Unchanged | Duplicates | Conflicts (the timetable wizard's
  filter set already covers the row classes; extend with `conflicts`).
- Every reference (semester, section, subject, teacher) is resolved server-side
  to its canonical label so the admin can eyeball the match.
- Prevent a client from pre-empting server decisions: confirm accepts only the
  session uuid; severity/lock is re-derived on the server (§9 step 6).

---

## 13. Import Plan Design

> **NEW FEATURE.** The stored plan is the admin-visible contract.

- A confirmed import plan is a list of `planned` rows, each classified as
  `new_*` / `update_*` / `unchanged` / `duplicate` / `error`, exactly like the
  timetable importer's `plan_rows`/`classify_status` result
  (`timetable_import.py:976-1028`).
- Common per-kind differences captured in the plan model:
  - Students: `create_student` | `update_student` (+ `provision_account`) |
    `unchanged` | `duplicate`/`conflict` | `error`.
  - Teachers: same shape with `provision_account` on new teachers.
- Plan + summary are persisted on the session at upload time and **regenerated
  from `parsed_rows` at confirm time** (never trusted from the client; never
  mutated between upload and confirm).

---

## 14. Account Provisioning Design

> **NEW FEATURE.** The only place accounts are created from imports.

- A login account (one `accounts.User`) is provisioned **only for newly
  imported people** (student or teacher records that did not previously exist),
  and only when their imported status requires a login (recommended rule: only
  `active` → account; `graduated`/`inactive` master-data rows get the
  `Student`/`Teacher` record but **no login**).
- Existing people imported again: **no account created**, and the existing
  account's password is **never changed** (idempotent; §17).
- Provisioning runs inside the confirmed transaction (§20), then:
  `username = institutional ID`, `email = student/teacher email`,
  `role`, `is_active = True`, `must_change_password = True` (§16),
  `set_password(<ID>@123)` (§15) — password hashed with Django PBKDF2, never
  logged, never echoed back.
- One-to-one link: `User.student_profile` / `User.teacher_profile` set to the
  just-created profile. No account is created when the linkage already exists.
- **Administrative reverse path** (Django admin) must remain able to create
  people/accounts manually without going through the importer.

---

## 15. Identity & Username Rules

> **NEEDS CHANGE** (policy to formalize + code safeguards); values in §27.

- **Usernames = institutional IDs:** students `username == student_id`, teachers
  `username == teacher_id` (after trim/normalize/case handling).
- **Global uniqueness collision guard:** `User.username`, `User.email`,
  `Student.student_id`, `Student.email`, `Teacher.teacher_id`, `Teacher.email`
  are each unique — but the same value can legally exist across both tables
  (e.g., a repeated ID series, or one email on both a student and a teacher).
  The importer must treat an across-type collision (`student_id == a teacher_id`,
  shared email between a student and a teacher) as a **conflict → ERROR** that
  stops confirmation until the admin resolves it. The ADMIN is the sole
  arbiter; no auto-rename/merge.
- **Email is the fallback identity** when an ID is absent/ambiguous but is
  never used to "adopt" an existing record — a mismatched email on an existing
  identity is an `update` decision the admin confirms, never a merge.

---

## 16. Password & First-Login Rules

> **NEW FEATURE** (no password/identity lifecycle exists beyond login today).

- **Initial password:** `<ID>@123` (per institutional briefing; final value can
  be tuned in §27). Stored only as a hash (`set_password`); never printed,
  returned, or stored in the session/summary. IATA: not in the workbook.
- **First login:** `must_change_password=True` on newly provisioned accounts →
  the client's session-restore path (AuthContext) routes the user to a
  **forced password-change screen** before any other feature; the AuthContext /
  `me` response carries `must_change_password`. The backend enforces the same
  gate server-side (`MustChangePasswordGateMiddleware`, middleware.py): while
  the flag is set, every `/api/` route except `login`/`logout`/`me`/
  `password/change` returns `403 {code: "must_change_password_required"}`,
  so there is no bypass even for non-UI API clients.
- **Change endpoint:** `POST /api/auth/password/change/` (authenticated) —
  requires current password + new password; runs Django validators
  (MinimumLength/Common/Numeric); on success hashes the new password and clears
  `must_change_password`.
- **Reset endpoint (admin, discretionary):** `POST /api/auth/password/reset/`
  staff/admin-only, sets a new temp password + `must_change_password=True` —
  no email flow in scope (institution is offline-first).
- **Status rule (documented business rule, not code coupling):**
  `Student.status`/`Teacher.status` and `User.is_active` stay **independent**
  in this release. The importer provisions `is_active=True` for new people and
  never flips `is_active` off based on a status column — disabling a login is an
  explicit admin action (avoids accidental lockout during mass onboarding).

---

## 17. Idempotency Rules

> **NEEDS CHANGE** — the timetable importer already implements most semantics;
> student/teacher importers must adopt them.

- Same workbook, same DB state → identical plan (deterministic).
- Re-upload of an already-imported workbook → everything `unchanged`; no
  duplicate student/teacher/account rows; existing passwords untouched.
- Row identity = institutional ID (primary) then email (secondary, fallback).
- Update semantics: existing person re-imported with changed elective fields →
  `update_*` (admin confirms); identity-presenting differences (ID used by a
  different email/name) → `conflict → ERROR`.
- Confirm is single-shot and atomic: a second confirm of a `CONFIRMED` session
  fails; double-submit is harmless.

---

## 18. Timetable → Teacher Assignment Design

> **COMPLETE (Phase E)** — institutional `Teacher.teacher_id` is now the primary
> teacher identity in the timetable importer, with deterministic name fallback
> only when the workbook supplies no ID.

- Keep the entire live timetable import path; do **not** redesign completed
  Phases B.5/B.6/B.6-F. Phase E **extended** `academics/timetable_import.py`
  (`FIELD_ALIASES`, header mappings, `extract_rows`, new `resolve_teacher`,
  `plan_rows`, `execute_confirm`) without changing the staged preview → confirm
  architecture, endpoint shapes, or row identity rules.
- **Teacher matching (implemented):**
  - When the workbook supplies a Teacher ID column, `TimetableSlot.teacher` is
    matched **by `Teacher.teacher_id`** — authoritative, deterministic,
    case-insensitive (casefold), exact value only. No fuzzy, soundex, or
    "closest guess" logic anywhere.
  - Resolution by ID: exactly 1 match → resolved. 0 matches → hard error
    `UNKNOWN_TEACHER_ID` (blocking; **no** name fallback, **no** auto-create).
    >1 matches → hard error `AMBIGUOUS_TEACHER_ID` (defensive; `teacher_id` is
    unique). Supplied ID over `Teacher.teacher_id` max length (30) → hard error
    `TEACHER_ID_TOO_LONG`.
  - ID + name conflict (ID resolves but the lecturer/name column names a
    different existing teacher) → non-blocking `TEACHER_NAME_MISMATCH` warning;
    the ID-resolved record wins (mirrors the `TITLE_MISMATCH` convention).
  - When no ID is supplied (blank/whitespace cell, or no Teacher ID column at
    all), fall back to the existing deterministic two-pass normalized-name
    matching: 1 match → resolved; 0 → `UNKNOWN_TEACHER`; 2+ →
    `AMBIGUOUS_TEACHER`. Both remain hard errors.
  - Excel numeric IDs (e.g. `4471.0` → `"4471"`) and surrounding whitespace are
    normalized before lookup.
- **Header contract:** the teacher group is `lecturer` **or** `teacher_id`; the
  importer accepts either (or both) — a workbook carrying only a Teacher ID
  column is supported. `<teacher id>` aliases (reused from the Teacher import):
  `teacher id`, `teacher id number`, `lecturer id`, `instructor id`, `staff id`,
  `employee id`, `employee code`, `faculty id`, `faculty code`; bare `id` is
  deliberately **excluded** (ambiguous in a timetable, e.g. a system/row-number
  column). Placement before `lecturer` in `FIELD_ALIASES` makes an exact alias
  win over `lecturer`'s containment alias.
- **Preview/confirm contract:** preview surfaces per-row `teacher` resolution
  (`teacher_id`, `match_method: id|name`, `supplied_id`, `supplied_name`).
  Confirm re-validates every row against the current DB; **all-or-nothing** — if
  any row re-plans as an error (e.g. a teacher ID that no longer resolves), the
  entire commit is refused (`blocked_timetable_errors`, HTTP 400), zero
  `TimetableSlot`s are written, and the session stays pending.
- **Architectural lock:** the timetable import may reference existing
  `Teacher`, `Subject`, `Semester`, `Section` rows and create/update
  `TimetableSlot`s (and, on admin decision, `TeacherAssignment` wiring) — but it
  **never writes teacher master fields** (§4) and never provisions accounts.
  Master-data changes come only from the Teacher import.
- Whether the real workbook's teachers are keyed by ID, name, or column
  positions **cannot be finalized until the workbook is provided** (§27); the
  header alias vocabulary above is the current documented contract and is
  verified by `TimetableImportTeacherIdentityTests`.

---

## 19. Security Model

> **ALREADY EXISTS** (defenses in timetable importer) → **reuse**; plus
> **NEW FEATURE** provisioning guardrails.

- Admin-only endpoints (`IsAdminUser`) — established and tested.
- File gate: `.xlsx` only, 5 MB cap, corrupt/unreadable rejection, empty/header
  checks — established constants to reuse.
- Server-side parse using openpyxl reading values; no formula execution is
  needed/trusted; macros (`.xlsm`) are rejected by extension gate.
- No raw client row data ever reaches the plan (server `parsed_rows`).
- Passwords: only hashed (PBKDF2); never in logs, responses, or session
  storage; `must_change_password` gates the session until a real password is
  set — enforced both by the frontend gate (`App.tsx`) and, for API clients, by
  `MustChangePasswordGateMiddleware` (403 on every route but the lifecycle
  endpoints).
- Ownership: sessions scoped to `created_by`; token auth + throttling reused.
- Confirm re-validates server-side; `transaction.atomic()` protects partial
  writes; a failed commit leaves the session pending.
- Auditability: confirmed session captures file metadata + plan summary (§21).

---

## 20. Transaction Model

> **ALREADY EXISTS** for timetable (single atomic commit); **NEEDS CHANGE**
> (add account provisioning to the same transaction).

- **Recommended: ALL-OR-NOTHING** for students, teachers, and timetable — one
  `transaction.atomic()` block per confirmed session covering people-updates
  *and* account provisioning. Rationale: partial onboarding produces
  half-consistent cohorts (account without profile, attendance without the
  student), and the idempotent re-run path makes recovery trivial (just upload
  again after fixing the errors — everything is re-derived).
- Per-kind nuance recorded in the plan (all-or-nothing still applies):
  students may provision accounts; teachers provision accounts; timetable never
  provisions accounts.
- On failure: rollback, session stays `pending`, admin sees the error summary,
  can fix the workbook and re-run — no orphan rows, no half-provisioned users.

---

## 21. Audit History

> **NEEDS CHANGE** — generalize the timetable session shape; **NEW** for
> students/teachers.

- Keep `TimetableImportSession` as-is for timetable.
- **NEW:** `StudentImportSession`, `TeacherImportSession` (or one shared,
  `kind`-parameterized base) mirroring `TimetableImportSession` fields
  (`models.py:299`): `uuid`, `created_by`, `file_name`, `file_size`,
  `sheet_name`, `sheet_count`, `total_rows`, `parsed_rows`, `summary`, `status`
  (pending/confirmed), `created_at`, `confirmed_at`.
- `summary` records counts (new/update/unchanged/duplicate/conflict/error,
  accounts provisioned, password defaulted) — the durable, immutable audit
  result shown in an import-history modal (mirror `ImportHistoryModal.tsx`).
- History list scoped to `created_by` (admin-only anyway); read-only after
  confirmation; raw file bytes are not retained (metadata + plan only).

---

## 22. Test Plan

> Baseline exists (160 backend tests; vitest for `helpers.test.ts`,
> `importRowPresentation.test.ts`). **NEW** student/teacher/provisioning tests,
> following the timetable suite's style (see `apps/academics/tests.py`).

1. Unauthenticated upload/preview/confirm/history → 401.
2. Non-admin roles (teacher/student) on every action → 403.
3. Valid workbook → 200 preview with server-derived `session_uuid` + summary.
4. Missing file / wrong encoding → 400.
5. Oversized workbook (>5 MB) → 400 (mirror `test_oversized_file_rejected`).
6. Legacy `.xls` / unknown extension / `.xlsm` → 400.
7. Corrupt workbook → 400.
8. Missing required columns → 400; unknown columns → WARNING listed.
9. No data rows → 400.
10. Unknown semester/section/subject/teacher reference → per-row ERROR.
11. Ambiguous teacher name → ERROR (timetable); no fuzzy fallback.
12. Duplicate IDs and emails within the workbook → ERROR on later rows.
13. Cross-type identity collision (ID/email exists as the other kind) → ERROR.
14. New people → plan `new_*`; confirm creates records **and provisions
    accounts** with `<ID>@123` hashed (assert `check_password`, never plaintext),
    `must_change_password=True`.
15. Inactive/graduated import → profile only, **no account**; password never
    leaked.
16. Re-import same workbook → all `unchanged`; **existing accounts' passwords
    preserved**; zero new rows/users.
17. Transaction rollback: `transaction.atomic` failure (e.g. bad email mid-plan)
    → 400/500, nothing persisted, session stays pending.
18. Ownership: admin A cannot confirm/list admin B's session; confirmed session
    cannot be re-confirmed; confirm-without-upload → 404/400.
19. Provisioning safety: username = institutional ID; email already taken by a
    *user* of the other kind → conflict (not merged).
20. Frontend: wizard step gating (upload→review→confirm), severity filters;
    forced password-change screen reached when `must_change_password`; unit
    tests for extract/normalize/classify pure functions.

---

## 23. Required Database Changes

> Everything below is additive; **no destructive migrations**. Real Excel may
> reveal more — see §27.

- **NEW:** `StudentImportSession`, `TeacherImportSession` (or one generalized
  import-session model with a `kind` field) per §21.
- **NEW:** `accounts.User.must_change_password` (`BooleanField`, default
  `False`) + migration. `is_active` semantics unchanged.
- **NEEDS CHANGE (code-level, no schema):** email uniqueness *across*
  `User`/`Student`/`Teacher` enforced by the provisioning service/validator
  (DB-level cross-table unique is not possible without a shared key).
- Timetable tables untouched.

---

## 24. Required Backend Changes

> **NEW FEATURE** (with heavy reuse of `apps/academics/timetable_import.py`
> primitives).

- **NEW:** `apps/students/imports.py`, `apps/teachers/imports.py` (or a shared
  `apps/common/imports/` engine): header aliases, normalize/extract,
  quality/severity classifier, identity matcher, plan builder, idempotency,
  confirm/commit.
- **NEW:** `apps/students/import_views.py` / `apps/teachers/import_views.py`
  (or one generic viewset) with `preview` / `confirm` / history — `IsAdminUser`,
  owner-scoped, `.xlsx`+5MB gates.
- **NEW:** provisioning service (`apps/accounts/provisioning.py`):
  `provision_person(kind, profile, email) → (User, created)` — username from
  ID, hash temp password, set `must_change_password`, link profile, in the same
  transaction.
- **NEW:** auth endpoints `POST /api/auth/password/change/` and (admin)
  `POST /api/auth/password/reset/`; include `must_change_password` in
  `/api/auth/me/` response.
- **NEEDS CHANGE:** teachers' department/designation/qualification and
  students' contact fields gain import-friendly validators (case/whitespace
  normalization at import time, not model time).
- **NEEDS CHANGE:** `academics/timetable_import.py` teacher matching to accept
  an institutional teacher-ID column when present (§18) — gated on the real
  workbook.
- `TimetableImportViewSet` and its tests stay byte-for-byte compatible.

---

## 25. Required Frontend Changes

> **NEW FEATURE** (patterns already live in the timetable wizard).

- **NEW:** `src/features/students/import/StudentImportWizard.tsx` +
  `StudentImportHistoryModal.tsx` and equivalents under
  `src/features/teachers/import/` — clone/adapt `TimetableImportWizard.tsx`
  (Upload → Review → Confirm, severity filters, 5 MB client pre-check).
- **NEW:** `Import` button + entry in `StudentsView.tsx` / `TeachersView.tsx`
  toolbar opening the wizard.
- **NEW:** services `studentImportService.ts` / `teacherImportService.ts`
  (mirror the timetable live import API, `timetableLiveApi.ts`), types in `src/types/api.ts` and
  `src/types/index.ts`.
- **NEW:** forced password-change screen wired into `AuthContext`/`AppLayout`
  when `me.must_change_password` is true; change-password + admin reset UI in
  `UserProfileView`/`SettingsView`.
- **NEEDS CHANGE:** localized copy of classification filters to include
  `conflicts` where applicable.
- No React Router — new routes join the existing in-memory role map in
  `App.tsx` under the admin branch only.

---

## 26. Documentation Changes

> **NEEDS CHANGE** — several docs are stale; the archive contains removed
> mobile-era reports.

- **Fix first (already wrong today):**
  - `docs/22-KNOWN-ISSUES.md` K2 and `docs/23-IMPLEMENTATION-GAPS.md` still say
    timetable admin/import is localStorage-only — contradicted by live B.6-F
    (`docs/14-TIMETABLE-CALENDAR.md`). Correct these.
  - `docs/21-TESTING.md` claims no frontend automated tests — vitest already
    runs `helpers.test.ts` and `importRowPresentation.test.ts`. Correct
    coverage counts.
- **NEW:** this audit becomes `docs/25-INSTITUTIONAL-DATA-IMPORT.md`;
  regenerate `docs/README.md` index and `docs/00-SYSTEM-STATUS.md`.
- After implementation: extend `docs/03-AUTHENTICATION-RBAC.md` (first-login,
  change/reset, `must_change_password`), `docs/16-DATABASE.md` (new session
  models + user flag), `docs/17-API-REFERENCE.md` (new endpoints),
  `docs/18-FRONTEND.md` (import wizards + forced-password screen), and add
  import sections to `docs/05-STUDENT-MODULE.md` / `docs/06-TEACHER-MODULE.md`.

---

## 27. Waiting for Real Excel Data

> **CANNOT FINALIZE UNTIL REAL EXCEL IS PROVIDED.**

The complete institutional workbook (not supplied yet) is required before the
following can be locked down:

- Student column→model mapping. The known student sheet has ~58 columns
  including S.N., ID, Name, Roll Number, Id Number, National ID No.,
  DOB (A.D.), DOB (B.S.), Gender, Phone, Email, address components
  (village/municipality, ward, district, province), parent/guardian fields,
  EMIS ID, Symbol No., Registration No., house/label/project, admission year,
  program, semester/year, section/division, shift, lunch, sponsor, status,
  remarks, photo. Most are **not** current `Student` fields → the import will
  map the supported subset and classify the rest as ignored/WARNING/ERROR
  rather than invent model fields. Priority treatment (new) fields (e.g.
  nationality/caste/blood group/religion/ethnicity) requires an explicit
  product decision.
- Teacher workbook headings, program/semester/section/teacher reference
  conventions in the timetable workbook, DOB B.S.↔A.D. conversion calendar,
  and the exact temp-password policy (confirm `<ID>@123`).
  - **Phase E forward-progress:** the teacher reference convention is the one
    piece already implemented speculatively — the timetable importer accepts a
    `<teacher id>` column (alias vocabulary in §18) as the authoritative
    identity with deterministic name fallback. The real workbook must still be
    checked against these aliases and any institutional variant added.
- Header alias table finalization; per-field SUSPICIOUS thresholds;
  `MAX_DATA_ROWS` re-baseline for ~2,500-row cohorts.
- Whether any mapping needs **NEW database fields** (only then add the
  migration).

When the workbook arrives: capture workbook metadata → worksheet names →
header rows → representative rows → blank/merged/header anomalies → actual IDs
→ column mapping → run the system-check engine → review → implement mappings.

---

## 28. Recommended Implementation Phases

Ordered so each phase ends with passing tests and no production-data mutation
is possible before Phase B (nothing writes until confirm).

- **Phase A — Import Engine (backend foundation):** generalized
  upload/parse/normalize/classify/plan primitives generalized from the timetable
  importer; import-session models; `IsAdminUser` preview skeleton. Tests: §22
  categories 1–9.
  - **STATUS: COMPLETE.** New app `backend/apps/imports/` (`ImportSession`,
    migration `0001_initial`; generic engine in `engine/`: workbook gating,
    header-shape analysis, role-based cell normalization, row classification,
    in-file duplicate detection, deterministic summary). Endpoints (no confirm
    anywhere yet — Phase A documents the contract via `summary.block_confirmation`):
    `POST /api/imports/<kind>/preview/`, `GET /api/imports/<kind>/`.
    67 new tests (apps.imports) + full-suite regression (270 total) green;
    brand-new frontend foundation `src/features/imports/` (severity/summary
    helpers, badge/issue-list/summary-bar components, service with preview
    + history only) — vitest 29 green, `tsc --noEmit` and `vite build` clean.
    Nothing is exposed in production navigation. Alias tables stay empty pending
    the real workbook (§27); remaining phases unchanged below.
- **Phase B — Student Import:** `StudentImportViewSet` (preview/confirm,
  transactional, idempotent) + wizard/history UI + API/frontend/types. Tests:
  10–13 (student rows).
  - **STATUS: COMPLETE.** Backend: `apps/imports/student_import.py`
    (`FIELD_ALIASES`, `map_student_headers`, `extract_values`,
    `_resolve_semester`/`_resolve_section`/`_resolve_placement`,
    `enrich_row`, `build_student_summary`, `prepare_student_preview`,
    `execute_student_confirm`). DB matching is **student_id-only**; email is
    conflict-checked against other Students and all existing accounts. Plans:
    `new | update | unchanged | duplicate | error`; duplicates and any ERROR
    row block the whole confirm (code `blocked_student_errors`, 400). Confirm
    is all-or-nothing inside `transaction.atomic()` and idempotent.
    `POST /api/imports/students/confirm/` (owner+kind scoped, rejects
    already-confirmed sessions). Preview dispatches by `kind`. Frontend:
    `StudentImportWizard.tsx` (7 stages: Upload → System Check → Data Quality
    → DB Cross-check → Review → Confirm → Result), `StudentImportHistoryModal.tsx`,
    `studentImportService.ts`, `studentImportPresentation.ts` (+ vitest),
    wired into `StudentsView` via Import/History buttons. `api.ts` extended
    with student import types. Tests: **25 new backend tests** (apps.imports
    now 92 total, green), **8 new vitest** (37 total, green), `tsc --noEmit`
    and `vite build` clean, `makemigrations --check` clean. Program/Shift
    remain non-domain informational notes (documented limitations).
- **Phase C — Teacher Master Import:** mirror of Phase B for teachers; explicit
  "assignments untouched" tests. Tests: 10–13 (teacher rows).
  - **STATUS: COMPLETE.** Backend: `apps/imports/teacher_import.py`
    (`FIELD_ALIASES`, `map_teacher_headers`, `extract_values`,
    `_build_lookups`, `_compute_field_changes`, `enrich_row`,
    `build_teacher_summary`, `prepare_teacher_preview`,
    `execute_teacher_confirm`). `REQUIRED_FIELDS = (teacher_id, name, email)`;
    email is **required + unique** (per `Teacher` model) and lowercased. DB
    matching is **teacher_id-only**; email is conflict-checked against other
    Teachers and all existing accounts (`email_conflict`, ERROR, blocks).
    `department`/`designation`/`qualification` are free text (containment
    header matching) and only ever overwritten when the workbook cell is
    non-blank; `status` aliases map to active/inactive with blank → ACTIVE at
    confirm and unknown values → SUSPICIOUS `status_unknown` (non-blocking);
    `avatar` is intentionally **not** importable (account/profile-owned).
    Plans: `new | update | unchanged | duplicate | error`; duplicates and any
    ERROR row block the whole confirm (code `blocked_teacher_errors`, 400).
    Confirm is all-or-nothing inside `transaction.atomic()`, `full_clean()`
    per row, idempotent, and **never creates Users / passwords /
    TeacherAssignment** (accounts are Phase D). `views.py` refactored to a
    shared `ImportConfirmView` base (`kind` + `executor`) —
    `POST /api/imports/teachers/confirm/` is owner+kind scoped and rejects
    already-confirmed sessions; preview dispatches by `kind`. Frontend:
    `TeacherImportWizard.tsx` (7 stages, mirroring Phase B),
    `TeacherImportHistoryModal.tsx`, `teacherImportService.ts`,
    `teacherImportPresentation.ts` (+ vitest), wired into `TeachersView` via
    Import/History buttons. `api.ts` extended with teacher import types. Tests:
    **35 new backend tests** (apps.imports now 127 total, green), **8 new
    vitest** (45 total, green), `tsc --noEmit` and `vite build` clean,
    `makemigrations --check` clean. Documented limitation: the real
    institutional Teacher workbook is still pending (§27), so header aliases are
    safe best-effort guesses that must be re-confirmed against the actual
    workbook before production use.
- **Phase D — Account Provisioning & Identity Lifecycle:**
  `must_change_password` field+migration, provisioning service, change/reset
  endpoints, forced first-login screen, cross-type conflict guards. Tests:
  14–19.
  - **STATUS: COMPLETE.** Backend: `apps/accounts/provisioning.py` owns the
    deterministic rules — username == normalized institutional ID (global
    namespace; a cross-type collision is `ACTION_CONFLICT` and blocks),
    initial password == `<ID>@123` hashed via `set_password` (never stored,
    returned, logged, or rendered — documented bootstrap exemption from
    validators, §8), `must_change_password=True`, eligibility limited to ACTIVE
    master rows, and re-import safety (existing linked accounts keep username,
    password, flag, and `is_active` untouched; second-run confirms are
    `unchanged` with `accounts_provisioned: 0`). Migration `0004_user_must_change_password`.
    Endpoints: `POST /api/auth/password/change/` (self-service; current password
    required; every configured validator enforced; `must_change_password`
    cleared; all existing tokens revoked and a fresh one returned in the
    response), `POST /api/auth/password/reset/` (admin-only; returns the account
    to the bootstrap lifecycle — password never revealed), `/api/auth/me/`
    exposes `must_change_password`. Student and teacher confirms now provision
    accounts inside the same atomic transaction and report
    `accounts_provisioned`; previews carry a per-row `account` consequence and a
    rolled-up `summary.accounts` count (never any password). Server-side gate:
    `MustChangePasswordGateMiddleware` answers 403 on non-lifecycle
    `/api/` routes while `must_change_password` is set (no bypass for
    non-UI clients). Tests: 356 total (348 at the end of Phase D plus 8 new
    first-login-gate tests in `accounts/tests/test_provisioning.py`), green. Frontend: `mustChangePassword` on `User` +
    `MePayload`/`mapUser`, `authService.changePassword`/`adminResetPassword`,
    `AuthContext.mustChangePassword`/`changePassword`, new
    `ForcedPasswordChangeView` shipped as a hard gate in `App.tsx` (the whole
    portal is unreachable until the temporary password is replaced),
    account-consequence column + Phase D account-provisioning panel in both
    import wizards, and an "Accounts Provisioned" tile on confirm results.
    `api.ts` extended with account-action types. Tests: vitest 51 green,
    `tsc --noEmit` clean, `vite build` clean, `makemigrations --check` clean.
- **Phase E — Timetable Teacher-ID Matching:** extend the live importer to
  prefer institutional teacher ID when the real workbook provides one
  (§18).
  - **STATUS: COMPLETE.** Backend `apps/academics/timetable_import.py`:
    `teacher_id` header field (aliases from the Teacher import; before
    `lecturer` so exact alias wins; bare `id` excluded), teacher group =
    `lecturer` **or** `teacher_id`, `extract_rows` normalization (whitespace,
    Excel numeric IDs), new `resolve_teacher` (ID authoritative: length guard
    `TEACHER_ID_TOO_LONG`; casefold `iexact` lookup; 0 → `UNKNOWN_TEACHER_ID`
    blocking with **no** name fallback; >1 → `AMBIGUOUS_TEACHER_ID`; ID+name
    conflict → non-blocking `TEACHER_NAME_MISMATCH` warning with ID winning;
    blank ID → existing two-pass name matching, 0 → `UNKNOWN_TEACHER`, 2+ →
    `AMBIGUOUS_TEACHER`). Preview rows carry `teacher.teacher_id /
    match_method (id|name) / supplied_id / supplied_name` and `row.teacher_id`.
    `execute_confirm` is now **all-or-nothing**: any row that re-plans as an
    error blocks the whole commit (`blocked_timetable_errors`, 400, nothing
    written, session stays pending), fixing a latent gap where preview-era
    error/conflict rows could previously be committed. `views.py` surfaces the
    blocking message. Tests: **26 new backend tests**
    (`TimetableImportTeacherIdentityTests`, apps.academics now 79, full suite
    382 total, all green) including a §12 data-safety test proving PREVIEW only
    creates the staging session (no master-data mutation) and BLOCKED confirm
    writes zero `TimetableSlot`s. `makemigrations --check` clean. Frontend:
    `ApiTimetableImportTeacherRef` (+`row.teacher_id`), presentation mapping
    (`teacherId`, `teacherMatch`, `teacherAamsId`, `supplied*`) + vitest, wizard
    Instructor column with `ID <teacher_id>` / `By name` badges, error-row
    blocking banner, step-2 gate on `error_rows > 0`, and confirm copy stating
    the all-or-nothing rule + teacher-ID revalidation. Tests: vitest 53 green,
    `tsc --noEmit` clean, `vite build` clean. Header alias vocabulary remains a
    best-effort contract until the real workbook arrives (§27).
- **Phase F — Audit, Docs & Hardening:** ownership/staleness edge tests
  (18), report §26 doc fixes, regenerate status docs, run the full suite +
  `npm run lint`/`build`.
  - **STATUS: COMPLETE.** Full-system Phase F audit (business rules,
    authorization, security, data integrity) with three parallel subagent
    sweeps. **5 defects found and fixed with regression tests:**
    1. Global exception handler crashed with `AttributeError` → 500 on a
       flat-list Django `ValidationError` (raised by UUID-field lookups);
       normalized to a 400 for both ValidationError shapes
       (`config/exceptions.py`).
    2. Confirm endpoints accepted any malformed `session_uuid` string and
       crashed/behaved inconsistently at the ORM; both now validate UUID
       format first and return 400 `session_uuid_invalid`
       (`apps/imports/views.py`, `apps/academics/views.py`).
    3. Timetable workbooks over `MAX_DATA_ROWS` were silently truncated to the
       first 5000 rows; preview now rejects the worksheet with 400
       `file_too_many_rows` before planning
       (`apps/academics/timetable_import.py`).
    4. Concurrent confirm requests for one session could double-commit rows;
       both confirm views now lock the session row with
       `select_for_update()` inside `transaction.atomic()`, re-check status
       under the lock and serialize — exactly one commits, losers get 400
       `already_confirmed`.
    5. Student/teacher rows that passed the preview regexes but failed Django
       `full_clean()` at commit leaked raw ValidationError detail; they are
       now converted to a deterministic 400 `row_validation_failed` (_0 rows
       written, session remains pending_) — e.g. `alice@example..com`.
    **Regression tests:** +9 backend (`391` total, all green) incl. a
    thread-based concurrency test (`apps/academics/tests_timetable_concurrency.py`).
    Gates: `makemigrations --check` clean, vitest 53/53, `tsc --noEmit` clean,
    `vite build` clean. **Browser E2E** re-verified admin/teacher/student role
    scopes + direct unauthorized API calls (403/403/400
    student/teacher/admin) against the running stack
    (`phase_f_e2e_*.png`). Docs updated: §11 confirm-time error contract,
    §5 upload caps, 14 §7.4 confirm codes, 01 architecture handler/lock notes.
    Git: not a repo (Phase F git step = N/A). Remaining findings (reported,
    not altered — Phase G scope): deterministic bootstrap password
    `<username>@123` (documented admin reset), frontend has no global catch-all
    403 route guard, token stored in sessionStorage.

---

## 33. Phase H — Server-Backed Import & Export (IMPLEMENTED)

Status: **COMPLETE.** Phase H turns the audited design + Phase D/E pipelines into
a fully server-backed, admin-only import AND export surface for **Students,
Teachers, and Timetable**, with strict **UPLOAD ≠ IMPORT** semantics.

### 33.1 What was added

- **Student / Teacher analyze → stage → confirm** in `apps/imports`
  (`student_import.py`, `teacher_import.py`, `views.py`, `urls.py`):
  - `POST /api/imports/{kind}/preview/` — parses/normalizes/classifies an
    `.xlsx`, stores a pending `ImportSession`, returns summary + rows + issues.
    **Writes nothing** to master data.
  - `POST /api/imports/{kind}/confirm/` — re-reads the stored plan, re-validates,
    commits atomically + idempotently under `select_for_update()`; re-runs of
    the same workbook yield `unchanged`, never duplicates.
  - `GET /api/imports/{kind}/` and `/{uuid}/` — session history + staging reads.
- **Timetable import** already lived under `/api/academics/timetable-import/`;
  Phase H added **server-generated template + export** and wired the admin UI.
- **Server-generated `.xlsx` downloads** (openpyxl), admin-only:
  - `GET /api/imports/students/template/`, `GET /api/imports/teachers/template/`,
    `GET /api/academics/timetable-import/template/`
  - `GET /api/imports/students/export/`, `GET /api/imports/teachers/export/`,
    `GET /api/academics/timetable-import/export/`
  - Canonical header set lives in `AppsImportsContracts` / `templateContract.ts`
    (single source of truth shared by templates, exports, and the classifier).
- **Frontend wizards** (`StudentImportWizard`, `TeacherImportWizard`,
  `TimetableImportWizard`) run the 7-step pipeline (Upload → System Check → Data
  Quality → DB Cross-check → Review → Confirm → Result). The client submits only
  the server-issued `session_uuid`; the server owns the plan.
- **`ImportTemplateCard`** with `Download
  Template` + `Download Export` embedded above the file picker in every wizard
  (Phase M: the card now renders the real required/optional column lists, the
  recognised-but-not-stored note, and the backend file limits, so the admin
  sees the exact column contract before selecting a file); export-only cards next
  to the toolbar `Export .xlsx` buttons on `StudentsView`, `TeachersView`,
  `TimetableAdminView`.
- **Safety contract preserved:** blank/bare workbooks are rejected (400, "no
  data rows"); `preview/` never mutates master records (tested); `confirm/` is
  all-or-nothing.

### 33.2 Test & gate status

- Backend: **409 tests** passing (`python manage.py test`), incl. the `imports`
  app suite (headers, normalization, duplicates, rows, severity, security,
  data-safety, student/teacher import, templates/exports, workbook).
- Frontend: **75 Vitest tests** passing; `npm run lint` (`tsc --noEmit`) clean;
  `npm run build` clean.
- **Browser E2E (Phase H):** admin login → Students: `Export .xlsx` (200,
  `aams_students_export.xlsx`); wizard `Download Template` (200,
  `aams_student_import_template.xlsx`); full round-trip upload → analyze →
  confirm of a generated workbook (new student committed, visible in directory,
  export grew accordingly); Teachers: `Export .xlsx` (200,
  `aams_teachers_export.xlsx`), wizard appears with template/export card;
  Timetable: `Export .xlsx` (200, `aams_timetable_export.xlsx`).
- **Bug fixed during E2E:** `TeachersView` loaded its four enrichment endpoints
  via `apiClient.get` and called `.map()` on the raw DRF page envelope →
  `TypeError` surfaced as "Unable to load faculty / Request failed (undefined)".
  Switched the Promise.all to `apiClient.list` (pagination unwrap). See
  `docs/22-KNOWN-ISSUES.md` K6.
- Docs updated: 00, 17, 18, 22, 23, 25, and `PHASE_H_REPORT.md`.