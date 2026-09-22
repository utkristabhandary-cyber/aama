# AAMS — Testing

## Status: SUBSTANTIAL BACKEND COVERAGE; NO FRONTEND AUTOMATED TESTS

AAMS is web-only; Android and desktop-companion tests were removed with the deleted code in Phase 2.

## Backend Tests (Django)
| Suite | File | Areas |
|-------|------|-------|
| Accounts | `apps/accounts/tests/test_auth.py` | login, logout, token expiry, throttling, me |
| Accounts identity | `apps/accounts/tests/test_identity.py` | role resolution, teacher/student scoping |
| Academics | `apps/academics/tests.py` | semester/section/subject/assignment/timetable rules |
| Attendance | `apps/attendance/tests.py` | session lifecycle, mark/bulk/roll/submit, QR, network policy, duplication, retarget persistence |
| Reports | `apps/reports/tests.py` | summary, by-subject, shortage/clear 75% |
| Teachers | `apps/teachers/tests.py` | roster, me, per-class reports |

Run unit tests: `py manage.py test` (from `backend/`).

## Coverage Gaps
1. **No frontend (web) automated tests** — no Jest/Vitest/Playwright test suite found for `src/`.
2. **No backend tests** for the `notifications` app beyond what the shared suites cover.

## What This Supports
- Given the breadth of backend unit/API tests (160 tests current), the server-side attendance/QR logic is well covered and is the highest-confidence part of the system.