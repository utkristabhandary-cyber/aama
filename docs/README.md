# AAMS — Academic Attendance Management System

## Documentation Index

This directory contains the living, authoritative documentation set for AAMS. It is
regenerated from the actual repository code (the source of truth), not from prior reports.
AAMS is **web-only** (Phase 2 removed the Android app, desktop companion, offline/sync,
and BSSID/device-registration architecture).

| # | Document | Purpose |
|---|----------|---------|
| 00 | SYSTEM-STATUS | Overall health, phase status, completion state |
| 01 | ARCHITECTURE | High-level system architecture and component topology |
| 02 | REQUIREMENTS | Web-only system requirements + removed scope |
| 03 | AUTHENTICATION-RBAC | Auth flow, token lifecycle, role model |
| 04 | ACADEMIC-MODULE | Semesters, sections, subjects, assignments |
| 05 | STUDENT-MODULE | Student web capabilities |
| 06 | TEACHER-MODULE | Teacher web capabilities |
| 07 | ADMIN-MODULE | Admin web capabilities |
| 08 | ATTENDANCE-SYSTEM | Core attendance session engine |
| 09 | QR-ATTENDANCE | QR roll-call token system |
| 14 | TIMETABLE-CALENDAR | Timetable slots, teaching sessions, holidays |
| 15 | REPORTS-ANALYTICS | Report endpoints and aggregation |
| 16 | DATABASE | Full schema documentation |
| 17 | API-REFERENCE | Complete API inventory |
| 18 | FRONTEND | Web frontend structure & integration |
| 20 | SECURITY-AUDIT | Security findings classified by severity |
| 21 | TESTING | Test inventory and status |
| 22 | KNOWN-ISSUES | Known bugs, limitations, conflicts with reports |
| 23 | IMPLEMENTATION-GAPS | Mismatch between current and target |
| 24 | NEXT-PHASE-PLAN | Recommended implementation order |
| | AUDIT-MATRIX | Master feature-by-feature status table |
| | CAMERA_SCANNER_AUDIT_REPORT | QR camera scanner audit & fix (this item) |
| | archive/ | Historical phase reports, removed-architecture docs, AI Studio scaffold metadata |

> Numbered docs in `archive/` (10-NETWORK-BSSID-VERIFICATION, 11-MOBILE-DEVICE-REGISTRATION,
> 12-OFFLINE-ATTENDANCE, 13-SYNCHRONIZATION, 19-MOBILE-APP) describe the pre-Phase-2
> mobile/companion/offline architecture and are preserved for reference only.

## Status Legend

- **IMPLEMENTED** — verified in the actual code path and functional evidence exists.
- **PARTIALLY IMPLEMENTED** — some required functionality exists but important pieces are missing.
- **MISSING** — required functionality does not exist.
- **BROKEN** — functionality exists but currently does not work.
- **BLOCKED** — cannot currently be verified because of an external/manual/environment limitation.
- **UNKNOWN** — insufficient evidence; do not guess.

## Project Layout

```
aams-—-academic-attendance-management-system/
├── backend/          Django REST Framework backend
├── src/              Vite + React 19 frontend (web)
├── docs/             This documentation set (+ archive/)
```

## Authority

This documentation set is regenerated from the repository code. If a prior report
(e.g. `docs/archive/PHASE*.md` or `docs/archive/AAMS_AUDIT_REPORT.md`) conflicts with the
actual code, the code wins; the conflict is documented in `22-KNOWN-ISSUES.md`.