# PHASE H REPORT — Institutional Data Import & Export (Server-Backed)

Status: **COMPLETE** — 19 September 2026

Scope: turn the institutional workbook onboarding (Students, Teachers, Timetable)
into a fully **server-backed** surface: analyze → stage → confirm, server-generated
templates and exports, and admin wizard integration. Strict **UPLOAD ≠ IMPORT**:
uploads never mutate master data; only the final, server-issued confirm step writes.

---

## Deliverable Checklist (24/24 DONE)

### Backend — API & pipeline (`backend/apps/imports/`, `apps/academics`) 

1. **DONE** — Student import pipeline: `POST /api/imports/students/preview/`
   parses/normalizes/classifies an uploaded `.xlsx`, stores a pending
   `ImportSession`, returns summary + mapped rows + issues. No writes.
2. **DONE** — Student import confirm: `POST /api/imports/students/confirm/`
   commits all planned rows atomically + idempotently
   (`select_for_update()` under `transaction.atomic()`); re-runs yield
   `unchanged`; 400 error codes write nothing.
3. **DONE** — Teacher import pipeline: `POST /api/imports/teachers/preview/`
   with the same staging contract (upload-only, no account/assignment writes).
4. **DONE** — Teacher import confirm: `POST /api/imports/teachers/confirm/`,
   all-or-nothing, deterministic, idempotent.
5. **DONE** — Import session list + detail reads: `GET /api/imports/{kind}/`
   and `GET /api/imports/{kind}/{uuid}/` (history + re-reading a staging plan).
6. **DONE** — Server-generated **student template**: `GET
   /api/imports/students/template/` → canonical `.xlsx`
   (`aams_student_import_template.xlsx`), `Content-Disposition: attachment`.
7. **DONE** — Server-generated **teacher template**: `GET
   /api/imports/teachers/template/` (`aams_teacher_import_template.xlsx`).
8. **DONE** — Server-generated **student export**: `GET
   /api/imports/students/export/` → live records as `.xlsx`
   (`aams_students_export.xlsx`).
9. **DONE** — Server-generated **teacher export**: `GET
   /api/imports/teachers/export/` (`aams_teachers_export.xlsx`).
10. **DONE** — **Timetable** template + export endpoints wired/verified on
    `/api/academics/timetable-import/template|export`
    (`aams_timetable_export.xlsx`), alongside the existing preview/confirm.
11. **DONE** — **Header contract single-sourced**: canonical template/export
    column set defined once and shared by templates, exports, and the
    classifier (`AppsImportsContracts` / frontend `templateContract.ts`) so the
    exported file is always re-importable ("round-trip" property).
12. **DONE** — **Admin-only authorization** on all preview/template/export/
    confirm/list actions; non-admins are rejected (403), downloads are
    admin-only.

### Engine — safety & correctness

13. **DONE** — Blank / bare-template uploads rejected (400 "no data rows")
    instead of silent success.
14. **DONE** — Duplicate handling + normalization + severity classification
    preserved from the audited engine (headers/normalize/duplicates/rows/
    severity/data-safety tests all pass).
15. **DONE** — Concurrency safety preserved: double-confirm of one session
    serializes — exactly one commits, losers get 400 `already_confirmed`.
16. **DONE** — Preview never mutates master records (explicitly regression-tested,
    incl. staged-but-unconfirmed sessions leaving zero rows).

### Frontend — UX wiring (`src/features/imports`, `src/services`)

17. **DONE** — `StudentImportWizard` runs the full 7-step server pipeline
    (Upload → System Check → Data Quality → DB Cross-check → Review → Confirm →
    Result); client only re-submits `session_uuid`.
18. **DONE** — `TeacherImportWizard` wired identically (incl. teacher-ID matching
    badges and error-row blocking on Confirm).
19. **DONE** — `TimetableImportWizard` wired to the timetable server pipeline
    with all-or-nothing confirm.
20. **DONE** — `ImportTemplateCard` ("Ready for Analysis / Export": `Download
    Template` + `Download Export`) embedded in all three wizards; export-only
    cards + `Export .xlsx` toolbar buttons on `StudentsView`, `TeachersView`,
    `TimetableAdminView`.
21. **DONE** — `importExportService` (shared download handler with filename
    extraction + `saveDownload`) and `importsService` / `timetableImportService`
    cover preview, staging reads, confirm, and downloads.

### Tests, gates, E2E & docs

22. **DONE** — Frontend: **16 new Vitest tests** (import/export service, template
    contract, import presentation/severity/summary, timetable import-row
    presentation, helpers) → **75 total, all green**; `tsc --noEmit` clean;
    `vite build` clean.
23. **DONE** — Backend: **409 tests** passing (`python manage.py test`),
    incl. the `imports` app suite; `makemigrations --check` clean.
24. **DONE** — **Browser E2E** against the live stack: admin login; Students
    export → 200 `aams_students_export.xlsx`; wizard `Download Template` → 200
    `aams_student_import_template.xlsx`; full generated-workbook round-trip
    (upload → analyze → confirm → student visible, export grew); Teachers export
    → 200 `aams_teachers_export.xlsx`; wizard renders template/export card;
    Timetable export → 200 `aams_timetable_export.xlsx`. Docs updated: 00/17/18/
    22/23/25 + this report.

---

## Regression catches during E2E

| # | Finding | Resolution |
|---|---------|-----------|
| 1 | `TeachersView` failed to load (`Unable to load faculty — Request failed (undefined)`): `loadData` used `apiClient.get` and called `.map()` on the raw DRF page envelope (`Fe.map is not a function`) | Switched the Promise.all to `apiClient.list<…>` (pagination unwrap); page, wizard, and export verified in-browser — `docs/22-KNOWN-ISSUES.md` K6 |

## Verification commands

```
cd backend && python manage.py test            # 409 OK
npm run lint                                    # tsc --noEmit, clean
npm test                                        # vitest run, 75 OK
npm run build                                   # vite build, clean
```

## Notes for maintenance

- The live browser E2E added one real student (`NE-3000` E2E round-trip) to the
  development database as part of the confirm-path verification; it is legitimate
  demo data and can be removed via the admin UI if not wanted.
- `vite preview` (or `npm run dev`) + `python manage.py runserver` (both fixed to
  one process each, port 3000 / 8000) are the supported way to run the stack —
  do **not** start a second preview/runserver on the same port (caused the
  duplicate/ghost-server issues seen during testing).