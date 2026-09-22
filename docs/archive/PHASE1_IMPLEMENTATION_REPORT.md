# Phase 1 — Implementation Report (Critical Correctness)

**Project:** AAMS — Academic Attendance Management System
**Root:** `C:\Users\utkri\OneDrive\Desktop\aams\aams-—-academic-attendance-management-system`
**Baseline:** `AAMS_AUDIT_REPORT.md` (P0 section). Phase 1 scope = the 7 staged items listed in the task instructions.
**Result:** Typecheck (`npm run lint` → `tsc --noEmit`) **passes (exit 0)** and production build (`npm run build` → `vite build`) **passes (exit 0)**.

---

## 1. Route navigation fix — Student "Scan Attendance QR"

**Item 1 (P0-1):** `src/features/student/StudentDashboard.tsx` changed `onNavigate('scan-qr')` → `onNavigate('qr-scanner')` so the student button opens the real scanner route.

- Verified: `src/App.tsx` maps `qr-scanner` → `StudentQRScannerView` (student role).

## 2. Route-guard hardening

**Item 2 (P0-2):** `src/App.tsx`
- Unmapped/unknown view ids now render `NotFoundView` (created `src/components/NotFoundView.tsx`) instead of falling through to `AdminDashboard`.
- The render switch `default` case also renders `NotFoundView`.
- The role guard is preserved: known views that exist but are not allowed for the current role still render `UnauthorizedAccessView`.

- Verified: guard reads `VIEW_ROLE_PERMISSIONS[currentView]`; `!allowedRoles` → NotFoundView; `!allowedRoles.includes(role)` → UnauthorizedAccessView. Typo'd/forged route ids can no longer reveal admin UI to students.

## 3. No automatic Present — explicit attendance only

**Item 3 (P0-5):** `src/features/attendance/TakeAttendanceView.tsx`
- Records no longer seeded `present`; the roster effect initializes `setRecords({})` when not in an active QR session.
- Student table renders unmarked students as `UNMARKED` (neutral Badge), and none of the Present/Absent/Late buttons are highlighted until chosen.
- `handleSubmitManual` blocks submission when zero students are explicitly marked (toast: "Mark each student as Present, Absent, or Late before submitting").
- `src/features/attendance/AttendanceAdminView.tsx`
  - Detail modal no longer treats missing records as `present` (renders `UNMARKED`) — `status = detailSession.records[stu.id]` without `|| 'present'`.
  - Detail modal resolves the **full combined roster** across `detailSession.sectionIds` (deduped), not only the first section.
  - Session table/section filter resolve combined sections so combined sessions list all participating sections (e.g. `Sec A + Sec B`).

- Verified: with a clean store, opening manual attendance shows every student `UNMARKED`; an empty submission is rejected; a partial submission records only marked students. `getStudentAttendanceSummary`/`getStudentSubjectAttendance` were already records-based, so denominators only ever count recorded sessions.

## 4. Combined-section attendance persistence + roster resolution

**Item 4 (P0-4):**
- `src/services/attendanceService.ts`
  - `submitAttendance` (and `submitAttendanceSession`) accept and persist `teachingSessionId`, `sectionIds`, and `isCombined` on the `AttendanceSession`.
  - Effective `sectionIds = data.sectionIds || [data.sectionId]`; `isCombined` derived from effective count.
  - `getSessions` section filter matches any session whose participating sections include the filter (combined-aware).
  - `getStudentAttendanceSummary` section filter is combined-aware.
- `src/features/attendance/TakeAttendanceView.tsx` `handleSubmitManual` now passes `teachingSessionId`, `sectionIds: selectedSectionIds`, `isCombined`.
- `src/services/qrAttendanceService.ts` `finalizeQRSession` persists `teachingSessionId`, full `sectionIds`, and `isCombined`.
- `src/services/reportService.ts` `generateReport` and `lowAttendanceStudents` section filters are combined-aware.
- `src/services/teacherService.ts` `getTeacherReports` matches class sessions when **any** participating section overlaps the class's section ids.
- `src/features/student/StudentDashboard.tsx` subject-breakdown includes combined sessions containing the student's section.

- Verified: a combined (Sec A + Sec B) manual/QR session saves `sectionIds:[a,b]`, `isCombined:true`, `teachingSessionId`; admin history shows both sections and full roster; student from either section sees the session in dashboards and reports.

## 5. Real QR code end-to-end

**Item 5 (P0-3):**
- Dependency `qrcode@1.5.4` (with `@types/qrcode`, dev) and `jsqr@1.4.0` (ships its own types) added.
- New `src/services/qrPayload.ts`: payload scheme `AAMSQR1|<session-id>|<TOKEN>`; `encodeQRSessionPayload` builds it; `decodeQRSessionPayload`/`extractTokenFromPayload` accept either a full payload or the raw 8-char token.
- `src/features/attendance/TakeAttendanceView.tsx` renders a **real scannable QR** (`QRCode.toDataURL`) over the live rolling token, regenerated on each 15-second rotation, replacing the static decoy SVG.
- `src/features/student/StudentQRScannerView.tsx` adds a jsQR decode loop over the camera frames; each detected code feeds through the existing `handleSubmitToken` → `submitStudentAttendance` path (dedupe guard re-scans the same code at most once per 7 s), with a "QR Code detected — verifying attendance..." status line. Manual token entry and "Quick Scan Match" remain.
- `src/services/qrAttendanceService.ts` `submitStudentAttendance` normalizes any input through `extractTokenFromPayload`, so a scanned payload and a manually-typed token both verify. 15-second rotation and expiry checks unchanged.

- Verified: the projected QR decodes to the payload; scanner submit path verifies the payload's token; raw token manual entry still works; invalid/expired tokens produce the existing rejection toasts.

## 6. One-module-per-teacher rule enforced in the service layer

**Item 6 (R12 / P0-7):**
- New `src/services/academicRules.ts`:
  - `getDistinctSubjectsForTeacherInSemester(teacherId, semesterId, opts?)` gathers distinct subjects from active assignments + teaching sessions + timetable slots (optionally excluding a slot being edited).
  - `assertTeacherSingleModulePerSemester(...)` throws a descriptive rule-violation error when the teacher is already assigned a *different* subject in the semester.
- Enforcement points wired:
  - `src/services/assignmentService.ts` `createAssignment` (before duplicate check).
  - `src/services/timetableService.ts` `createSlot` and `updateSlot` (candidate-based; excludes the slot under edit).

- Verified: gate cannot be bypassed through any of the write paths that currently exist (assignment create, timetable create/update). Same-subject multi-section teaching remains allowed.

## 7. Seed/demo data made consistent with the rule

**Item 7:** `src/data/initialData.ts`
- `asg-6` teacherId `tch-1` → `tch-3` (Suman teaches DBMS sub-103 in sem-1 for 1A and 1B).
- `tt-17` teacherId `tch-1` → `tch-3`, moved `Sunday 11:15–12:15` → `Monday 11:15–12:15` (tch-3 is free after Monday 09:00–10:00 tt-4; no teacher/room/section conflict — Lab 1 has no other booking, sec-1b's Monday classes end at 11:00).
- `att-sess-10` teacherId `tch-1` → `tch-3` to match corrected `tt-17`.
- `ts-2` subjectId `sub-103` → `sub-101` (Rajesh/tch-1 teaches only Programming Fundamentals sub-101 in sem-1); notes updated to match the subject.

- Verified: after a factory reset, tch-1 teaches only `sub-101`; tch-3 teaches only `sub-103` in sem-1; assignments, timetable, teaching sessions, and attendance records agree; the new `assertTeacherSingleModulePerSemester` passes across all seed data.

## 8. Pre-existing typecheck errors fixed

Fixed so `npm run lint` (tsc --noEmit) exits 0:
- `StudentProfileView.tsx:104` `Badge variant="neutral"` → `default`.
- `StudentProfileView.tsx:156` `summary.totalSessions` → `summary.total`.
- `StudentQRScannerView.tsx` `Badge variant="primary"` → `info`.
- `StudentReportsView.tsx` `ProgressBar color=` → `colorScheme=`.
- `TeacherReportsView.tsx` `Badge variant="neutral"` → `default`.
- `TeacherStudentsView.tsx` `Badge variant="primary"` → `info`.

---

## Verification checklist

| Phase 1 item | Status | How verified |
|---|---|---|
| Scan-QR route → qr-scanner | ✅ | `StudentDashboard.tsx` navigate target matches App route map |
| App route hardening (404 + role guard) | ✅ | Unknown view → NotFoundView; known-but-forbidden → UnauthorizedAccessView; default → NotFoundView |
| No auto-Present; explicit-only | ✅ | Roster starts empty; UNMARKED rendering; empty-submit blocked; percentages count only recorded sessions |
| Combined-section persistence + roster | ✅ | sectionIds/isCombined/teachingSessionId saved (manual + QR); combined-aware filters across services, reports, dashboards, admin detail |
| Real QR (encoder + scanner) | ✅ | qrcode renders payload over rolling token; jsQR decodes camera frames; service accepts payload or raw token |
| One-module-per-teacher enforcement | ✅ | academicRules helper enforced in assignmentService.createAssignment + timetable createSlot/updateSlot |
| Seed data obeys the rule | ✅ | asg-6, tt-17, att-sess-10, ts-2 corrected; no residual conflicts |
| Typecheck / build green | ✅ | `npm run lint` exit 0; `npm run build` exit 0 |

---

## Created & modified files

Created:
- `src/components/NotFoundView.tsx`
- `src/services/qrPayload.ts`
- `src/services/academicRules.ts`
- `PHASE1_IMPLEMENTATION_REPORT.md`

Modified:
- `src/App.tsx` (import + guard + default case → NotFoundView)
- `src/features/student/StudentDashboard.tsx` (route id)
- `src/features/attendance/TakeAttendanceView.tsx` (explicit-only records, empty-submit block, combined persistence, real QR render)
- `src/features/attendance/AttendanceAdminView.tsx` (combined filters, full detail roster, UNMARKED)
- `src/services/attendanceService.ts` (sectionIds/isCombined/teachingSessionId persist; combined-aware filters)
- `src/services/qrAttendanceService.ts` (finalize combined fields; payload token extraction)
- `src/services/reportService.ts` (combined-aware section filters)
- `src/services/teacherService.ts` (combined-aware class-session matching)
- `src/services/assignmentService.ts` (business rule enforcement)
- `src/services/timetableService.ts` (business rule enforcement)
- `src/data/initialData.ts` (seed corrections)
- `src/features/student/StudentQRScannerView.tsx` (jsQR decode loop; badge variant fix)
- `src/features/student/StudentProfileView.tsx`, `src/features/student/StudentReportsView.tsx`, `src/features/teacher/TeacherReportsView.tsx`, `src/features/teacher/TeacherStudentsView.tsx` (type fixes)
- `package.json` (added `qrcode`, `jsqr`, `@types/qrcode`)

---

## Remaining findings (NOT addressed in Phase 1 — deferred)

P0:
- **Fake import pipeline** (audit §5 P0-6): `timetableApi.analyzeFile` returns hardcoded rows/sheets, `discoverRelationships`/`validateRows`/`confirmImport` fall back to existing rows, and imports never create assignments/teaching sessions (so imported slots never reach "My Classes"). Recommendation: truthful rewrite or removal — **not** part of the Phase 1 list of 7 items.

P1:
- P1-8 Calendar declarations (EVENT/SPECIAL_DAY, multiple per day, Saturday system holiday) + honest holiday impact wiring.
- P1-9 Promotion + CSV integration (real archive; note "Zero Data Loss" copy).
- P1-10 Storage reset/export missing `teachingSessions`/`importHistory`.
- P1-11 Remove hardcoded dashboard stats & dates.
- P1-12 Reconcile dual timetable models (TimetableSlot vs TeachingSession).
- P1-13 Remove or implement decorative Academic Year filter.

P2:
- P2-14 Percentage fallbacks (`92`/`90`/`88`) return fabricated values on empty data.
- P2-15 Notification `target`/`targetRole` cosmetic.
- P2-16 Profile resolution falls back to first student/teacher.
- P2-17 Import wizard PostgreSQL copy.
- P2-18 Settings policies saved/used nowhere; 75% threshold hardcoded.
- P2-19 Unscoped `reportService.generateReport` (view-layer guard only).
- P2-20 Fake import-history seed row.
- P2-21 JSON export omits teaching sessions.