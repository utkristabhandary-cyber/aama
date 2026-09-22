# Phase F — Full-System Audit, Defects Fixed & Hardening Report

Generated: 19 September 2026

## 1. Scope & Method

Full-system **business-rule / authorization / security / data-integrity audit**
of AAMS (web-only). The `apps` layer was the final authority for every finding;
defects were **fixed**, not merely reported, and each fix carries a regression
test. The audit ran as three parallel subagent sweeps:

- Imports & Exceptions (student/teacher/timetable import pipelines, confirm
  end-to-end, error envelopes)
- Timetable & Concurrency (timetable import parity, DB-safety, concurrent
  confirm)
- Coverage matrix (which Phase-D/E behaviors have explicit tests; which gaps
  are NOT yet covered)

## 2. Defects Found & Fixed (5)

### 2.1 Global exception handler crash on flat-list `ValidationError` — 500 → 400
`config/exceptions.py` used `exc.message_dict` unconditionally. Django's
`ValidationError.message_dict` raises `AttributeError` for **flat-list** errors
(e.g. `ValidationError("X is not a valid UUID.")` — the exact shape raised by
UUID-field ORM lookups). Any endpoint doing a `.get(uuid=...)` with a malformed
UUID would 500.

**Fix:** try `message_dict`, fall back to `messages` on `AttributeError`; both
shapes now normalize to a 400 with a predictable `detail`.
**Test:** `apps/imports/tests/test_security.py::ExceptionHandlerUnitTests`
(direct handler calls, flat-list and dict forms).

### 2.2 Confirm endpoints crashed / behaved inconsistently on malformed `session_uuid`
Both `ImportConfirmView.post` (`apps/imports/views.py`) and
`TimetableImportViewSet.confirm` (`apps/academics/views.py`) passed the raw
string into the ORM. A non-UUID string produced a flat-list Django
`ValidationError` (→ the 2.1 crash / 400-by-accident), and a valid-but-unknown
UUID produced a 404. Contract was inconsistent across the three endpoints.

**Fix:** new `_is_valid_uuid(value)` helper; both views validate the UUID format
up front and return `400 {code: "session_uuid_invalid", detail: ...}` before any
ORM access. Existing 404 (`session_not_found`) and 400 (`session_uuid_required`,
`already_confirmed`) codes preserved.
**Tests:** `test_confirm_malformed_session_uuid_rejected_400` in
`test_student_import.py`, `test_teacher_import.py`, and
`apps/academics/tests.py::TimetableImportConfirmTests`.

### 2.3 Timetable workbook silently truncated beyond 5000 rows
`timetable_import.load_workbook_sheet` bounded reading at
`MAX_HEADER_SEARCH_ROWS + MAX_DATA_ROWS` and `prepare_preview` extracted the
(truncated) rows into the plan with no error — a >5000-row workbook would
silently drop rows, and the confirm would commit only the visible head.

**Fix:** after required-column validation, a new guard counts meaningful data
rows (using a local `_row_has_content` mirror of `classifier.has_content` to
avoid a circular import) and rejects the worksheet with
`400 {code: "file_too_many_rows", detail: "The first worksheet has N data rows,
but the maximum supported is 5000 rows."}` before `extract_rows`.
**Test:** `apps/academics/tests.py::TimetableImportFileValidationTests
::test_too_many_data_rows_rejected` (5001-row workbook built via `_xlsx_bytes`).

### 2.4 Concurrent confirm requests could double-commit the same session
Both confirm views read the session, checked `status == PENDING` **outside** any
lock, then executed the import. Two racing confirms for one session could both
pass the check and both run `execute_confirm`, creating duplicate
`TimetableSlot`s / rows.

**Fix:** both confirm views now wrap the status check + execution in
`transaction.atomic()` and acquire the session row with `select_for_update()`
before re-checking status under the lock. Exactly one request commits; the
loser blocks on the row lock and then returns 400 `already_confirmed`. The
success response is re-read after commit (`ImportSession.objects.get(pk=...)`)
so the returned payload reflects the confirmed session.
**Test:** `apps/academics/tests_timetable_concurrency.py` — a
`TransactionTestCase` (real commits, so row locks genuinely contend) that
primes a pending session, then fires two confirm requests from two threads
(synchronized with `threading.Barrier`, one `APIClient` + committed token per
thread). Asserts: one 200 + one 400 `already_confirmed`, and exactly **one**
`TimetableSlot`.

### 2.5 Student/teacher rows passing preview could fail `full_clean()` at commit
The preview regexes are deliberately loose (so preview surfaces rows as valid),
but Django's `full_clean()` at commit is authoritative — e.g. an email like
`alice@example..com` passes `_EMAIL_RE` yet fails Django's `EmailValidator`.
Previously that raw Django `ValidationError` bubbled out of the executor with an
inconsistent shape and no machine-readable code.

**Fix:** `student_import.py` and `teacher_import.py` wrap each
`obj.full_clean()` / `existing.full_clean()` and convert raised Django
`ValidationError`s into `ImportRowError(code="row_validation_failed",
message='Row for student "... " failed validation: ...')`. Since the executor
runs inside the view's atomic block, nothing is written and the session stays
`PENDING`.
**Tests:** `test_confirm_returns_row_validation_failed_code` in
`test_student_import.py` and `test_teacher_import.py` (double-preview then
confirm a `..` email row; assert 400 `row_validation_failed` + 0 rows written).

## 3. Regression-Test Counts

| Gate | Before Phase F | After Phase F |
|---|---|---|
| Backend `manage.py test` | 382 OK | **391 OK** (+9: 3 malformed-uuid, 2 handler, 2 full_clean, 1 file_too_many_rows, 1 concurrency) |
| `manage.py makemigrations --check` | clean | clean |
| Vitest (`npm run test`) | 53/53 | 53/53 |
| `tsc --noEmit` | clean | clean |
| `vite build` | clean | clean |

## 4. Browser E2E — Role Boundaries (re-verified)

Ran against the live stack (backend :8000, `vite preview` :3000, seeded demo
data). Screenshots: `docs/../phase_f_e2e_{admin,teacher,student}.png`.

- **Admin** signs in → full admin sidebar (Academic Structure, People &
  Assignments, Operations incl. Timetable/Attendance/Reports, System).
- **Teacher** (`tch-3`) signs in → **Teaching Portal only** (Dashboard/My
  Classes/My Students/My Timetable/Take Attendance/Session History/Class
  Reports). No admin/import/promotion/settings menus.
- **Student** (`std-1`) signs in → **Student Portal only** (QR Attendance, My
  Attendance, Class Schedule, Attendance Reports, Calendar & Holidays).

Direct unauthorized API calls (independent of the UI):

| Call (as) | Endpoint | Result |
|---|---|---|
| student token | `POST /imports/students/preview/` | 403 `You do not have permission...` |
| teacher token | `POST /imports/students/preview/` | 403 |
| admin token | `POST /imports/students/preview/` (no file) | 400 `file_required` (boundary reached, validation gate) |
| teacher token | `POST /academics/timetable-import/confirm/` | 403 |
| student token | `POST /academics/timetable-import/confirm/` | 403 |

## 5. Docs Updated

- `25-INSTITUTIONAL-DATA-IMPORT.md`: §11 gains a **Confirm-time error
  contract** (`file_too_many_rows`, `row_validation_failed`,
  `session_uuid_invalid`, `already_confirmed`) + concurrency note; Phase F
  status block completed.
- `14-TIMETABLE-CALENDAR.md`: §7.4 confirm failure codes + upload caps
  (`MAX_DATA_ROWS` rejection, no silent truncation) documented.
- `01-ARCHITECTURE.md`: handler now covers both `ValidationError` shapes;
  `select_for_update()` locking note added.

## 6. Git

`git` is **not** initialized in this workspace → Phase F git step recorded as
**N/A**. No repo actions taken.

## 7. Reported But NOT Altered (Phase G scope)

These were investigated during the audit and intentionally left for a
dedicated hardening phase:

- **Deterministic bootstrap password** — importer-provisioned accounts and
  `admin_password_reset` use `<username>@123` (documented; see
  `apps/accounts/provisioning.py` + docs). Fixed only in Phase G.
- **Frontend role gating is route-map-based** (`App.tsx` `VIEW_ROLE_PERMISSIONS`)
  with no global catch-all 403 route for unknown/banned views.
- **Token in sessionStorage** — survives reload but not cross-tab; a Phase-3
  hardening candidate.
- Previously confirmed NON-defects (no change made, asserted by tests):
  `login` accepts inactive accounts (false — `user_can_authenticate` runs);
  in-file duplicates handled on normalized values; `getTeacherClasses`
  ignoring `teacherId` is safe (backend scopes).

## 8. Deviations & Caveats

- Not a code defect: the LSP "cannot resolve django/rest_framework" diagnostics
  in the edited files are analyzer-environment false positives (no Django env in
  the analyzer scope); all files compile and the migrated suite validates.
- The concurrency regression test is intentionally isolated in its own
  `TransactionTestCase` file (real commits require it) rather than inside the
  `APITestCase` academics base.