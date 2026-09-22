# AAMS — Codebase Audit Report

**App:** AAMS — Academic Attendance Management System (AI Studio prototype, `metadata.json`)
**Audit scope:** READ-ONLY review of the entire `src/` tree. No code changes made.
**Result:** Complete. All files read, all critical requirements traced to code with evidence.

---

## 1. The actual app directory

```
C:\Users\utkri\OneDrive\Desktop\aams\aams-—-academic-attendance-management-system
```

| Item | Value |
|---|---|
| Type | Vite + React SPA (AI Studio export). NOT Next.js |
| Package | React `^19.0.1`, Vite `^6.2.3`, TypeScript `~5.8.2`, Tailwind `^4.1.14`, lucide-react, motion |
| Server deps | express, dotenv, @google/genai (Gemini API — see `metadata.json`) |
| Package manager | bun |
| Dev command | `vite --port=3000 --host=0.0.0.0` |
| Persistence | `localStorage`, keys prefixed `aams_data_v1_` (`src/services/storage.ts:32`) |
| Real backend | None yet. UI copy references Django REST Framework + PostgreSQL as the target production stack; not implemented (`UnauthorizedAccessView.tsx:41`) |

---

## 2. Architecture

- **No router.** `App.tsx` manages a single `currentView` state string and conditionally renders one of ~25 views inside `AppLayout` (dark sidebar + header + main).
- **Route guard:** `VIEW_ROLE_PERMISSIONS` map (`App.tsx:49-84`) authorizes view ids to roles; `App.tsx:123-134` renders `UnauthorizedAccessView` when the *known* view is not allowed for the current role.
- **Data layer:** a singleton `DataStore` class (`storage.ts`) holds every collection in memory and mirrors each to `localStorage`; all writes dispatch a `aams_storage_change` window event so views re-read synchronously.
- **Service layer:** thin async wrappers around `store` with fake `delay()` to simulate network latency (`authService.ts:7`).
- **Auth:** mock. `authService.login` matches email only and **ignores the password**; `loginAsRole` picks the first user of a role; on load `getCurrentUser` auto-logs-in the first admin. Header contains a demo **role switcher** (`Header.tsx:33`, `switchRole`).
- **Dual timetable models** (a root cause of inconsistencies):
  1. `TimetableSlot` — the weekly admin timetable; includes `sectionIds[]`/`isCombined` for combined sessions (`types/index.ts:97-111`).
  2. `TeachingSession` — "My Classes" blocks for teachers; also supports `sectionIds[]`/`isCombined` (`types/index.ts:118-131`).
- Teachers see "My Classes" built from assignments → teaching sessions (`teacherService.getTeacherClasses`), while "My Timetable" is built from `TimetableSlot`. These two data sets are **not synchronized** and seed data contradicts itself (see §6).

---

## 3. Route map (`App.tsx` switch)

| Route id | View | Roles |
|---|---|---|
| `dashboard` | Admin/Teacher/Student dashboards | all |
| `academic`, `semesters`, `sections`, `section-allocation`, `subjects`, `teachers`, `students`, `assignments`, `timetable`, `attendance`, `attendance-history`, `promotion`, `settings` | Admin CRUD/ops | admin |
| `my-classes`, `teacher-students` | Teacher scope | teacher |
| `take-attendance` | Take Attendance (manual + QR) | admin, teacher |
| `qr-scanner` | Student QR scanner | student |
| `my-attendance`, `my-history` | Student records | student |
| `my-timetable` | Teacher/Student schedule | teacher, student |
| `reports` | Role-scoped reports | all |
| `calendar` | Calendar & Holidays | all (admin sidebar includes it; teacher sidebar does not) |
| `notifications`, `profile` | Shared | all |
| **default** | **AdminDashboard** | — |

**Critical flaw:** unknown view ids are *not* blocked by the guard (the guard only fires when `VIEW_ROLE_PERMISSIONS[view]` exists). Anything unmapped falls through the switch `default` to **AdminDashboard** (`App.tsx:256-262`). This is exactly why the Student "Scan Attendance QR" button is broken (§5, P0-1).

---

## 4. Requirement status matrix

Legend: ✅ implemented · ⚠️ partial · ❌ missing · 🐞 broken (exists but wrong / harmful) · ℹ️ out of scope

| # | Requirement / constraint | Status | Evidence | Notes |
|---|---|---|---|---|
| R1 | Teacher QR generator for taking attendance | ⚠️ | `TakeAttendanceView.tsx` | UI: "Live QR Roll Call" toggle, 15s countdown, readable token, live submit counter, end-session save. **The rendered QR is a static decorative SVG — it does not encode the rolling token** (no `jsqr`/`qrcode`/`barcode` library anywhere in `src`). Not actually scannable. |
| R2 | 15-second QR/token rotation | ✅ | `qrAttendanceService.ts` `refreshIntervalSeconds: 15`, `tokenExpiresAt = date + 15s` | Tokens are 8 chars excluding `0/O/1/I`. Works as a rolling code scheme. |
| R3 | Teacher attendance workflow (manual Present/Absent/Late) | ⚠️ | `takeAttendance` route → `TakeAttendanceView.tsx`; `attendanceService.ts`; `AttendanceAdminView.tsx` | Manual flow works, but default-initializes **all students to `present`** ("mark absentees") and duplicates are checked by `sectionId` only. See P0-5. |
| R4 | Recency / grace window: 15-min grace must NOT auto-mark Late; Late is manual only | ✅ | grep `grace` → no matches anywhere | No automatic-late logic exists. `late` is stored/weighted `0.5` in percentages only (`storage.ts:379,416`; `attendanceService.ts:152-156`). |
| R5 | Academic Calendar: holiday declarations (HOLIDAY/EVENT/SPECIAL_DAY) | ❌ | `types/index.ts:336-344`; `CalendarHolidaysView.tsx`; `holidayService.ts` | Only `Holiday` with type `institutional/national/festival/restricted/emergency`. No EVENT/SPECIAL_DAY, no `declarations[]`. |
| R6 | Holiday deletion | ✅ | `CalendarHolidaysView.tsx:90-104` "Revoke", `holidayService.deleteHoliday` | Works. |
| R7 | Multiple events/declarations per day | ❌ | `CalendarHolidaysView.tsx:214` `holidays.find(h => h.date === dateKey)`; `holidayService.isHolidayDate` `.find()` | One declaration per date only; second declaration overwrites earlier `hol-id`? No — it creates a second row, but the calendar cell shows only the first via `.find()`. |
| R8 | Permanent Saturday system holiday | ❌ | `types/index.ts:95` `DayOfWeek = Sunday…Friday`; no `saturday` anywhere in `src` | Saturday is **absent from the type** and from all day pickers, so no class can be scheduled on Saturday and no logic marks it. The calendar grid still renders a "Sat" column with no special styling (`CalendarHolidaysView.tsx:196`). |
| R9 | Strict role separation | ⚠️ | `App.tsx:49-134`; `Sidebar.tsx:47-148` | UX-level only (accepted — real auth is Django later). But see **P0-1/P0-2**: default case renders AdminDashboard and unmapped ids bypass the guard. |
| R10 | Promotion + CSV workflow | ❌ | `PromotionView.tsx` (manual wizard); `sectionAllocationService.ts` / `SectionAllocationCSVView.tsx` (separate feature) | Promotion is manual checkbox multi-select → single target section (`PromotionView.tsx:98-127`). CSV reallocation exists but is scoped to **resections within one semester**, is NOT promotion, and the two are not integrated. No public "CSV promote" flow. |
| R11 | Combined teaching sessions = array of section ids (no fake "F1+F2+F3" names) | ✅ | `TimetableSlot.sectionIds`, `TeachingSession.sectionIds`, `AttendanceSession.sectionIds`; storage normalization `storage.ts:232-249` | Model is correct. Import pipeline *parses* combined expressions and resolves to real ids (`parseCombinedSections`, `timetableApi.ts:43-86`). |
| R12 | One teacher cannot teach two different modules in the same semester | 🐞 | `assignmentService.createAssignment` duplicates-check only (`assignmentService.ts:14-22`); seed violates it | No rule enforcement. Seed: Rajesh (tch-1) teaches `sub-101` **and** `sub-103` in sem-1 (`initialData.ts:239-296` + teaching sessions `ts-1`/`ts-2`). |
| R13 | Attendance statuses must remain Present/Absent/Late | ✅ | `AttendanceStatus = 'present'\|'absent'\|'late'` (`types/index.ts:308`) | Entry points keep all three. QR flow restricts to present/late (`qrAttendanceService.ts:131,152`). |
| R14 | Course / BCA / MBA / program management | ℹ️ | — | Out of scope; not present. AAMS models Semester → Section → Subject → TeacherAssignment → Student. |

---

## 5. Priority implementation order

### P0 — correctness & data integrity (fix first)

1. **🐞 Student "Scan Attendance QR" navigates to AdminDashboard.** `StudentDashboard.tsx:150` calls `onNavigate('scan-qr')` but the route id is `'qr-scanner'` (`App.tsx:77,194`; `Sidebar.tsx:83`). `'scan-qr'` is unmapped → guard passes → switch `default` renders AdminDashboard inside the student shell. Fix: route id, and make the switch `default` render a 404/unknown-view state instead of AdminDashboard.
2. **🐞 Route guard hole.** Unknown view ids bypass the guard and render AdminDashboard regardless of role (`App.tsx:123-134` + `default`). Any future typo silently shows admin data to students.
3. **🐞 QR "code" is a static SVG that does not encode the token** (`TakeAttendanceView.tsx`). Even though the token rotates every 15s, the displayed QR is constant decoy art. Genuine scannability needs a real QR encoder library and a token-encoded payload (or drop the visual QR and rely on the visible token, which students use via manual entry / simulated "Quick Scan Match", `StudentQRScannerView.tsx:104-105`).
4. **🐞 Combined-session data loss on save.** Both manual submit (`TakeAttendanceView.tsx` uses `sectionId: selectedSectionIds[0]`) and `qrAttendanceService.finalizeQRSession` persist only the first section and drop `sectionIds`/`isCombined`/`teachingSessionId`. AttendanceHistory must be able to reconstruct combined sessions.
5. **🐞 Attendance inflation.** Manual workflow seeds every student `present` (teacher must find absentees), and `AttendanceAdminView` detail modal treats any unrecorded student as `present` (`status = ... || 'present'`) AND lists only `getStudentsBySection(detailSession.sectionId)` (combined sessions show first-section roster only). This overstates attendance percentages.
6. **🐞 Fake import pipeline.** `timetableApi.analyzeFile` never reads the uploaded file — it returns hardcoded headers/rows/sheets (`timetableApi.ts:173-291`). `discoverRelationships` resolves unknown combined sections to `existingSections.slice(0,3)` (`:441`) and `validateRows`/`confirmImport` fall back to `existingSections[0]` (`:568,572,790`). `confirmImport` creates teachers/subjects but **not** assignments or teaching sessions, so imported slots never reach teacher "My Classes". The wizard even claims ingestion "into PostgreSQL data store" (`TimetableImportWizard.tsx:237`). This feature must be rewritten honestly or removed.
7. **🐞 No enforcement of the one-module-per-teacher rule** (R12). Needs validation in `assignmentService.createAssignment`/import and cleanup of violating seed rows.

### P1 — requirement completion

8. **Calendar:** add EVENT/SPECIAL_DAY declaration types + `declarations[]` per date; support multiple events per day; surface Saturday as a system (non-instructional) holiday in calendar rendering and in `isHolidayDate`; make the "will halt roll call / warn dashboards" claims true (currently only one `info` notification is created — `holidayService.ts:24-32`; dashboards hardcode today's demo stats instead of reacting).
9. **Promotion + CSV integration:** unify promotion with a CSV batch path (target semester + section mapping, unallocated handling, review/preview) reusing the real `sectionAllocationService` validation pattern rather than the current manual-only `PromotionView`. Note `promotionService.promoteStudents` moves students but does **not** archive anything, despite the "Zero Data Loss / archived" copy (`PromotionView.tsx:402-407`, `promotionService.ts:83-91`).
10. **Storage hygiene:** `resetAll()` does not reset `teachingSessions`/`importHistory` (`storage.ts:524-539`) and `exportStateJSON`/`importStateJSON` omit both (`storage.ts:471-517`) — backups and factory resets silently diverge.
11. **Honest dashboard data:** remove hardcoded demo values (`AdminDashboard.tsx`, `TeacherDashboard.tsx` — e.g. "Faculty Members 4", fixed ratios 89/87/92%, `averageRate: 89`, fixed today `2026-09-06`) and reconcile with real `new Date()` used by StudentDashboard. Move "today" from a constant to a shared clock so holiday/session logic is consistent.
12. **Reconcile the dual timetable models:** `INITIAL_TIMETABLE` (e.g. `tt-1` Rajesh Sunday 09:00 Sec 1A) directly contradicts `INITIAL_TEACHING_SESSIONS` (e.g. `ts-1` Rajesh combined 1A+1B Sunday 10:00; `ts-4` Anita combined 1A+1B Sunday 09:00, while `tt-2` puts Anita at 10:00). One source of truth should feed both "My Classes" and "My Timetable".
13. **Academic Year filter is decorative:** `TimetableAdminView.tsx:68` `filterAcademicYear` is never referenced in `filteredSlots`. Either implement or remove.

### P2 — polish & correctness details

14. **Report percentages lie when there is no data:** `getStudentAttendanceSummary` returns `92%` and subject returns `90%` on empty data (`storage.ts:379,416`); `ReportsView` falls back `: 88`. Return 0 / "N/A" instead.
15. **Notifications targeting is cosmetic:** the broadcast "Target Audience" `target` is never sent (`NotificationsView.tsx:79-83` passes only title/message/type) and the read path never filters by `targetRole` — a `teacher`-only notice (seed `notif-2`) is visible to all, and a broadcast "to students" is visible to everyone.
16. **Profile resolution bug:** `UserProfileView.tsx:22-23` looks up the student/teacher by `user.id` (e.g. `usr-student-3`) which never matches student ids (`stu-6`), then falls back to the **first** student/teacher — so Bipin sees Aarav's record. TeacherTimetableView/StudentTimetableView share the `|| teachers[0]` / `|| students[0]` fallback pattern.
17. **Import wizard toast text** claims PostgreSQL (§5-6) — fix copy.
18. **`SettingsView` policy form is cosmetic:** `attendanceThreshold`, `lateCreditWeight`, `allowTeacherEditHours`, `autoNotifyAbsentees`, `simulatedDelay` are local state only — saved to nothing, used by nothing (`SettingsView.tsx:25-47`). The 75% threshold used by PromotionView is hardcoded elsewhere (`PromotionView.tsx:84,342`).
19. **`reports` is granted to all roles but `reportService.generateReport` is unscoped** — a student can query any student's data via direct service call; guard at the view layer only (teacher/student views are correctly scoped, but the base `ReportsView` renders raw aggregated tables).
20. **Fake import history seed:** a fake "Apex_University_Timetable_Fall2026.xlsx" job is baked into storage defaults (`storage.ts:80-101`).
21. **`exportStateJSON` omits teaching sessions** (§10) also breaks round-trips for teacher class lists.

---

## 6. Problems & risks

1. **QR roll-call is non-functional end-to-end** (static decoy QR + no decode library + token auto-fill shortcut). The visible UX is complete, but a real student phone scanning the screen gets nothing. Highest-visibility risk.
2. **Student view can render AdminDashboard** (P0-1/2) — a demo-breaking, role-separation breach; also makes the "strict role separation" requirement look violated.
3. **Attendance numbers are inflated by design** (default-present + unrecorded=present) — reports, promotion eligibility (75% gate), and defaulter "alerts" all inherit wrong baselines.
4. **Two divergent data models for the same schedule** cause teachers to see contradictory My Classes vs My Timetable from clean seed state.
5. **Import flow fabricates results** and can silently map rows to `sec-1a` — dangerous if a real spreadsheet is ever fed in.
6. **Reset/backup don't cover teaching sessions or import history**, so "factory reset" and JSON restore both miss data that teachers depend on.
7. **Rule "one teacher one module per semester" unenforced and violated in seed.**
8. **Hardcoded dates (2026-09-06) and demo numbers** make the prototype look finished while inputs are constant — reviewers walking through "today" flows (Founders' Day holiday IS the seed's today) will see a holiday-quiet dashboard with fabricated ratios.
9. **Copy overpromises** ("PostgreSQL data store", "Zero Data Loss Guarantee", "halt timetable roll call", "warning notices in dashboards") where the code does none of these — erodes trust in the demo.
10. **No success criteria / tests:** there is no test runner configured; the only verification is manual browser use.

---

## 7. Implementation order (recommended sequence)

1. **P0-1/P0-2** Scan-QR route + guard hardening (5 min, de-risks every student flow).
2. **P0-5** Attendance default / unrecorded=present / combined-roster handling in `AttendanceAdminView` + manual flow.
3. **P0-4** Persist `sectionIds`/`isCombined`/`teachingSessionId` in submitted sessions (manual + QR finalize).
4. **P0-3** QR: add a real encoder + encode the rolling token (or convert the UI to token-only + copy button).
5. **P0-7 / R12** Enforce one-module-per-teacher in `assignmentService` + fix seed rows.
6. **P0-6** Rebuild or gate the import wizard: real CSV/XLSX parsing, strict mapping (no `existingSections[0]` fallback), create assignments + teaching sessions.
7. **P1-8** Calendar declarations (EVENT/SPECIAL_DAY, multiple per day, Saturday system holiday) + wire holiday impact into attendance/report logic honestly.
8. **P1-9** Unify promotion with the validated CSV batch workflow.
9. **P1-10/11** Storage reset/export coverage; kill hardcoded dashboard stats and date.
10. **P1-12/13** Single source of truth for schedule; remove/correct decorative filters.
11. **P2-14→21** Percentage fallbacks, notification targeting, profile resolution, settings wiring, report scoping, copy cleanup.

---

## Phase 3 — Visual & User Interface Assessment

**Overall verdict: polished, consistent, "enterprise demo" aesthetic — visually strong, semantically loose.**

- **Design language.** Tailwind v4 utility styling; `slate` neutral palette on `bg-slate-50`; indigo primary accent; white cards `rounded-2xl` with subtle `shadow-xs` borders; dark `slate-900` sidebar with lucide icons and an emerald "Highlighted" active state. Fonts: Plus Jakarta Sans (UI) + JetBrains Mono (ids, times, tokens). Dense, clean, professional.
- **Layout.** `max-w-7xl` containers; responsive `md:grid-cols-2/3` stat rows; tables with sticky headers, badges, and paginated feel; line/page-level navigation breadcrumb in the header (`Header.tsx:128`). Mobile drawer variant exists.
- **Dashboards.** Row of stat cards + decorative bar/area charts (motion-driven), recent-activity / alerts / upcoming-holiday lists. Charts are illustrative — numbers are hardcoded demo values (§6#8) rather than computed from the store.
- **Interactions.** Rich: modals with confirm dialogs, multi-step wizards (import 8 steps, promotion 3 steps), conflict toasts, QR token countdown ring, drag-drop CSV zones, tabbed previews. Generous loading/toast scaffolding (fake `delay`).
- **Role theming.** Teacher/Student shells restyle the same components (highlight badges, indigo vs emerald accents) — coherent but repetitive; views are genuinely different per role.
- **Microcopy problems (UI text overstates behavior):**
  - "Imports into the PostgreSQL data store" and "hard-coupled to the institutional database" (`TimetableImportWizard.tsx:226-308`) — persisted to `localStorage`.
  - "Zero Data Loss Guarantee … permanently archived" (`PromotionView.tsx:402-407`) — students are just moved; nothing archived.
  - Calendar modal: "Attendance marking will be automatically suspended" / "warning notices … in Teacher and Student Dashboards" / "halt timetable roll call" — actual effect is one `info` notification; dashboards show no reaction.
  - Report columns titled as if computed ("Attendance Percentage") while empty datasets fall back to `92`/`90`/`88`.
- **Accessibility.** Reasonable baseline: real `<button>`, focusable menus, aria labels on icon buttons, visible error/empty states, `UnauthorizedAccessView` explains denial. Gaps: a few color-only status distinctions (attendance badges rely on emerald/rose/amber); some small text at `text-xs`; no explicit skip-link. Acceptable for a prototype.
- **Visual-affordance traps.** The QR "code" is decorative art that can't be scanned but looks functional; the camera preview is a cosmetic `<video>`-like pane with a simulated scan shimmer; the "Settings save" button implies persistence but only toasts. Each looks finished and is not.

**List of the demo's strongest visuals to keep:** header + breadcrumb, takeover search modal, admin timetable (Section/Teacher/Semester/Combined tabs), CSV import preview with REJECTED badges, token ring + rolling countdown in Take Attendance, stat-card dashboards.

## 9. What is genuinely good (keep, don't rewrite)

- Data model supports combined sections as real id arrays (`sectionIds`) end-to-end (types, storage normalization, timetable creation, teaching sessions, attendance session type).
- `timetableService.checkConflicts` (`timetableService.ts:44-126`) is a solid, rule-complete conflict engine (teacher, room, all participating sections, Practical=single-section); `AddTimetableModal` surfaces live conflicts and blocks submit.
- `SectionAllocationCSVView` + `sectionAllocationService` is a **real, careful CSV workflow** (header validation, per-row matching by id/roll, REJECTED/Unallocated detection, preview tabs, apply).
- Role-scoped teacher/student dashboard & class views are properly scoped via service lookups (with the profile-fallback caveat above).
- Clean, consistent, professional Tailwind 4 UI; strong admin timetable UI (Section/Teacher/Semester/Combined views).
- Late = manual only, weighted 0.5 consistently — matches the stated attendance policy. No grace/auto-late anywhere (verified by grep).

---

*Audit performed against the codebase in `src/` — every claim above cites its file/line evidence. Nothing was implemented or modified.*