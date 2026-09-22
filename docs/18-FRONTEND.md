# AAMS — Frontend (Web)

## Status: IMPLEMENTED — all screens server-backed; legacy mock layer removed (Phase G); institutional import/export wired (Phase H)

## Stack
- React 19, Vite, TypeScript, Tailwind CSS.
- No React Router — navigation via in-memory route/state map in `App.tsx`.
- AuthContext (login/session restore), ToastContext.

## Phase H additions (institutional import/export)
- **`src/features/imports/StudentImportWizard.tsx` / `TeacherImportWizard.tsx`** and
  **`src/features/timetable/import/TimetableImportWizard.tsx`** drive the full
  server pipeline: upload → system check → data quality → DB cross-check →
  review → confirm → result. The client only re-submits the server-issued
  `session_uuid`; the server stores and re-validates the plan.
- **`src/features/imports/ImportTemplateCard.tsx`** — "Ready for Analysis /
  Export" card (`Download Template` + `Download Export`) embedded in each wizard.
  Export-only card rendered beside the toolbar buttons on `StudentsView`,
  `TeachersView`, and `TimetableAdminView` (`Export .xlsx`).
- **`src/features/imports/templateContract.ts`** — single source of truth for the
  canonical header set (SSOT columns) shared by templates, exports, and the
  classifier contract.
- **`src/services/importExportService.ts`** — `downloadBytes`-based template and
  export downloads (`/api/imports/{kind}/template|export`,
  `/api/academics/timetable-import/template|export`), filename extraction,
  admin-only; `importsService.ts` / `timetableImportService.ts` cover preview,
  staging reads, and confirm.
- Frontend test suite is now **75 Vitest tests** (59 Phase G + 16 Phase H:
  `importExportService`, `templateContract`, import presentation/severity/summary,
  timetable import-row presentation, section allocation, helpers).

## Structure (`src/`)

```
src/
├── main.tsx / App.tsx        route + role matrix (VIEW_ROLE_PERMISSIONS)
├── api/  (maybe), contexts/  AuthContext, ToastContext
├── components/ui/            Card, Button, Badge, Dialog, etc.
├── services/                 API services only (no localStorage mock layer)
├── types/
└── features/
    ├── admin/  academics, teachers, students, reports, dashboard, ...
    ├── teacher/ classes, students, reports, timetable, dashboard
    ├── student/ dashboard, attendance, history, timetable, QR, QR-scanner, reports, profile
    ├── attendance/ TakeAttendance + teacher/admin
    ├── promotion/  PromotionView (live reads; execution blocked — no backend endpoint)
    ├── reports/
    ├── timetable/  TimetableAdminView, import wizard, export
    ├── calendar/   holidays
    ├── notifications/
    ├── settings/   SettingsView (intentionally read-only — no settings API)
    └── profile/    UserProfileView
```

## API Integration Layer (`src/services/`)

- `apiClient.ts` — fetch wrapper, token from `sessionStorage[u'aams_auth_token']`, base `http://127.0.0.1:8000/api`, 401 handling, pagination unwrap. Central `errorMessage` helper.
- **Live** API services (use apiClient): `authService`, `semesterService`, `sectionService`, `subjectService`, `assignmentService`, `teacherService`, `studentService` (incl. `updateSectionAssignment` used by section-allocation apply), `holidayService` (read + declare/delete), `attendanceService`, `reportService` (summary + admin analytics), `notificationService` (own-scoped read/mark-read/delete), `sectionAllocationService` (live preview + PATCH apply), `importsService`, `timetableImportService`, `importExportService` (Phase H).
- **Deleted in Phase G** (no longer exists): `src/services/storage.ts`, `src/services/promotionService.ts`, `src/services/academicRules.ts`, `src/data/initialData.ts`. There is **no localStorage data store** in the frontend anymore.

## What Is Live vs Mock

### Live (server-backed, persists to PostgreSQL)
- Login/logout/me.
- Semesters, sections, subjects, assignments, holidays CRUD.
- Teachers, students CRUD + me.
- Attendance sessions, records, QR (start/check-in/stop).
- Reports summary & by-subject.
- Admin analytics & reports (`/api/reports/admin/`).
- Notifications (own-scoped read/mark-read/mark-all-read/delete).
- Teacher: own roster, own timetable (read), teaching-sessions, classes, reports.
- Student: own timetable (read), own attendance, QR scanner.
- Import/export (admin): analyze → stage → confirm pipelines + server-generated
  template/export `.xlsx` downloads for Students, Teachers, Timetable.
- Global search (admin/teacher/student role-scoped), header (no "Reset Demo Data"), profile (real institution + derived academic year).

### Mock / fabricated (NONE remaining)
- No frontend data is read from or written to localStorage beyond the auth session token (`sessionStorage["aams_auth_token"]`).

## Honest read-only boundaries (no backend feature — not simulated)
- **Promotion execution** — the wizard shows live cohorts and server-computed attendance; the Execute step is disabled with an explanatory banner (student semester is managed server-side / read-only). No promotion endpoint exists yet.
- **Settings editing** — `SettingsView` displays the institution/term (from the Semesters module), the server-enforced policy values (75% min attendance, 0.5x late credit, 24h edit window), and data-location notes; nothing is editable because there is no settings API.

> The admin broadcast/announcement UI was removed in Phase 8 (no backend endpoint exists); notifications are backend-owned and admin-created notifications are not part of the current scope.

## Security Note
- Auth token stored in `sessionStorage` (XSS-exposed). See `20-SECURITY-AUDIT.md`.
