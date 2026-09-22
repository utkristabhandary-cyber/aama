# AAMS — Phase G: Frontend Source-of-Truth Audit (28-Item Classification)

Date: 19 September 2026
Scope: Remove every fake, demo, or hardcoded institutional data source from the web frontend; wire every screen to the live DRF API; delete the dead localStorage store cluster; add regression tests; verify by automated gates + browser E2E across all three roles.
Deliverable: this 28-item classification, each item marked **AUDIT-CLEAN**, **FIXED**, **BY-DESIGN (read-only boundary)**, or **GAP (server-side, future phase — must not be simulated in the UI)**.

---

## 1. Findings Summary

| Category | Count | Status |
|----------|-------|--------|
| A. Pure demo/fake data sources | 7 | 4 deleted, 3 fixed to real data |
| B. Mock services reading/writing a fake store | 6 | 4 deleted, 2 rewired to live API |
| C. Features faking server behavior client-side | 7 | 3 fixed, 4 honest read-only boundaries |
| D. Dead code / orphaned references | 3 | all removed |
| E. Pre-existing correct behavior (verified) | 2 | AUDIT-CLEAN |
| F. Testing & verification | 3 | completed |

**Bottom line:** A sound, honest system. The recurring defect was a single design error — *institutional data flowed until it met the localStorage `store`, then died there*. That store no longer exists; every institutional-data path now terminates in the PostgreSQL server, and every feature that lacks a backend endpoint **says so in the UI** instead of simulating success (see section 6, "Honesty Policy"). Items requiring real backend work (promotion API, settings API, section-allocation bulk transaction) are tracked — none were fabricated.

---

## 2. Item-by-Item Classification (28 items)

### A. Pure demo / fake / hardcoded data sources (7)

1. **`src/services/storage.ts` — fake in-browser DB** (`db.get/set`, seeds, junk data). — **FIXED**: file deleted. Server is now the sole data store (Golden Rule 2 of docs/25). No remaining reads or writes anywhere.
2. **`src/data/initialData.ts` — seed payload for the fake store** (sections, subjects, teachers, students, attendance records). — **FIXED**: file deleted (and the empty `src/data/` directory removed).
3. **`src/services/academicRules.ts` — hardcoded academic year / policies presented as app-owned.** — **FIXED**: file deleted; `SettingsView` now reads semester-derived term and displays server-enforced policy values.
4. **Header "Reset Demo Data" button** — implied a demo dataset was in use and could be wiped. — **FIXED**: button + its store import removed. The app has no demo data.
5. **Global search over `store`** (students/teachers/subjects hardcoded to fake rows; `store` never loaded for real users). — **FIXED**: rewired to live `students/teachers/subjects` API (`GlobalSearchModal.tsx`), role-scoped, with loading/error/no-result states.
6. **UserProfileView hardcoded "Apex" branding + contact fake data + fake academic year.** — **FIXED**: institution from live semester; academic year derived from real semester dates; avatar from initials; unsplash dependency removed. Verified in browser as "AAMS Academic Attendance Management System".
7. **Teacher/Admin profile "Academic Year" fabricated.** — **FIXED**: derived from the server Semesters module; admin shows "—" (no semester), which is truthful.

### B. Mock services reading/writing the fake store (6)

8. **`timetableApi.ts` / timetable `store` mock for admin write.** — **FIXED (B.6-F, re-verified)**: admin timetable now persists via `/api/academics/timetable/` + import wizard; mock deleted.
9. **`promotionService.promoteStudents` — mutates fake store; UI reported success it could never have caused.** — **FIXED**: service deleted; view rewired to live reads.
10. **`sectionAllocationService` preview − reads fake `store` students (duplicating REAL rows and mislabeling them).** — **FIXED**: preview now validates against live student + section + semester API; sample rows classify (Change / No Change / REJECTED) instead of fabricating.
11. **`sectionAllocationService` apply − `store.saveStudent`, server never updated.** — **FIXED**: apply performs real `PATCH /api/students/{id}/` per row via `studentService.updateSectionAssignment`, including `null` section for unallocations; partial-failure results report per-row success/failure.
12. **`TimetableAdminView` — reads/writes fake store.** — **FIXED (B.6-F, re-verified)**: fully API-backed including combined-section handling.
13. **Notifications broadcast UI (fake store writes).** — **AUDIT-CLEAN**: removed in Phase 8; no mocked store writes remain (verified by grep).

### C. Features that faked server behavior client-side (7)

14. **Promotion wizard pretend-execution** — claimed progress/results with no server effect. — **FIXED**: Execute is now disabled with an explanatory banner (amber) explaining the destination semester must exist and a backend promotion API must exist; the wizard correctly shows live cohorts and server-computed attendance. **GAP (server-side)**: real promotion + attendance archival endpoint (student `semester` is write-protected on the API by design).
15. **TeacherStudentsView fake attendance "100%"** — `pct ?? 100` fabricated a perfect record. — **FIXED**: `pct == null` renders "—" + "No records yet" + Badge `default` "N/A"; server-computed percentages only. Verified live at 0% for a real teacher with no finalized sessions.
16. **TeacherStudentsView `aams_storage_change` listener** — dead code consuming a fake store event that no longer exists. — **FIXED**: listener removed.
17. **Section label double-prefix** ("Section Section A") from Section type doc inconsistency. — **FIXED**: single `formatSectionName` normalizes both `"A"` and `"Section A"` server values. Verified in browser.
18. **SettingsView fake persist** ("saved" with no server effect; export/import/reset of fake store). — **FIXED**: now a read-only summary with honest notes (server-enforced 75% threshold, 0.5x late credit, 24h edit window, data location). **GAP (server-side)**: a settings API to persist institution/policy values — not simulated.
19. **Dashboard/empty states implying demo data existed.** — **FIXED**: verified live "No course attendance data" honest empty state for the 5 real students; attendance summary reflects server data only.
20. **Profile/dashboard academic-year display pretending institutional enrollment context.** — **FIXED** as per items 6–7; no unverifiable claims are rendered anywhere (grep-clean).

### D. Dead code / orphaned references (3)

21. **`PromotionRecord` interface** orphaned after promotionService deletion. — **FIXED**: removed from `src/types/index.ts` (`SectionAllocationRow`, `SectionAllocationSummary` retained — still consumed).
22. **Empty `src/data/` directory.** — **FIXED**: removed.
23. **Stale lint-disable comments / demo-token guards** (mock-jwt scaffolding). — **FIXED**: grep for `mock-jwt`/demo-mode tokens across `src` returned nothing.

### E. Pre-existing correct behavior (verified, no change needed) (2)

24. **Auth + role matrix + API-wired module screens** (academics CRUD, attendance, reports, QR, notifications own-scoped). — **AUDIT-CLEAN**: confirmed all read/write live DRF endpoints; role-gate verified in browser for admins, teachers, students.
25. **Headers/sidebar navigation** (AAMS branding, no fake institution). — **AUDIT-CLEAN**: static product chrome, no data claims. Left as-is.

### F. Testing & verification (3)

26. **Regression tests for rewired behavior.** — **FIXED**: added `src/services/sectionAllocationService.test.ts` (6 tests: preview classification Change/No Change/REJECTED/Unallocated, invalid header, section-not-in-semester rejection, apply PATCH with id, apply `null` unallocation, partial-failure honesty). Suite now **59 tests / 7 files, all passing** (was 53).
27. **Automated gates.** — **PASSED**: `tsc --noEmit`; `vite build` (chunk-size warning only); Django suite **391 tests OK**; `makemigrations --check --dry-run` → "No changes detected" (no schema drift).
28. **Browser E2E, all three roles.** — **PASSED**: admin (live dashboard, live role-scoped global search, live section-allocation preview with REJECTED rows, promotion honestly blocked, read-only settings, profile branding), teacher tch-3 (real roster, "Section A/B" single-prefix, server-computed 0%), student std-1 (role gate, live profile, subject-scoped search). E2E also caught the real single-semester promotion bug (below). One console 403 on `/api/teachers/` during a student's role-gate transition is expected backend access control — not a defect.

---

## 3. Secondary Defect Found During E2E

**Promotion source-cohort vanished when the DB has one semester.** Old `loadData` set `fromSemesterId` only when `semList.length >= 2`, so with the single live semester "Semester 4 (2025-2026)" the source dropdown never populated and the wizard appeared broken.
**Fix (`PromotionView.tsx`):** always default `fromSemesterId = semList[0].id` (+ first matching section); only set destination when ≥ 2 semesters exist; amber notice: *"Only one semester exists on record. Create the destination semester in the Semesters module before promotion can run — nothing can be advanced yet."* Verified in browser (sections `A (T-301)`, `B (T-302)` populate; Execute disabled).

---

## 4. Deleted Code (complete list)

| Removed | Reason |
|---------|--------|
| `src/services/storage.ts` | fake in-browser DB |
| `src/data/initialData.ts` | seed payload for the fake DB |
| `src/services/academicRules.ts` | hardcoded academic rules presented as app logic |
| `src/services/promotionService.ts` | fake promotion mutation |
| `src/types/index.ts` → `PromotionRecord` | orphan after deletion |
| `src/data/` (empty dir) | residue |

No other consumers existed (all references audited + grep-verified before each deletion).

---

## 5. Genuine Future-Phase Gaps (must NOT be simulated)

1. **Promotion/archival backend API** — cohort advancement + attendance snapshot; `Student.semester` is write-protected by design. UI currently disables execution with explanation.
2. **Settings backend API** — persistence for institution/policy values. UI is read-only.
3. **Bulk section-allocation transaction endpoint** — apply is currently a client loop of `PATCH /api/students/{id}/` (correct and honest, but not a single server transaction). Fine for current scale.

---

## 6. Honesty Policy (adopted this phase)

1. The server is the sole source of truth; the frontend **never** fabricates a record, a percentage, an academic year, or a saved confirmation.
2. Where a backend feature does not exist, the UI **says so inline** (disabled + explanatory banner/note) rather than performing a pretend action.
3. No demo dataset or demo reset surface exists anywhere.

---

## 7. Verification Evidence

- `npm run lint` (tsc `--noEmit`): PASS
- `npm test` (Vitest): **59 passed** (7 files)
- `npm run build` (vite build): PASS (chunk >500 kB warning only)
- `python manage.py test`: **391 OK** (≈434 s)
- `python manage.py makemigrations --check --dry-run`: **No changes detected**
- Browser E2E admin/teacher/student: PASS (see item 28; plus the single-semester promotion defect in section 3)
- Final grep across `src`: `Apex`, `Demo Data`, `demo-mode`, `demo mode`, `mock-jwt`, `92%`, `90%`, `88%`, `89%` → **no matches** (no fabricated values, no demo scaffolding, no hardcoded percentages)

## 8. Doc Updates Made Alongside This Report

- `docs/00-SYSTEM-STATUS.md` — mock-migration line closed; Phase G row; test counts refreshed (391 backend / 59 frontend).
- `docs/17-API-REFERENCE.md` — admin dependency table rewritten: no localStorage mocks remain.
- `docs/18-FRONTEND.md` — mock service layer removed from structure; live/read-only boundaries documented.
- `docs/22-KNOWN-ISSUES.md` — K2/K3/L2 RESOLVED; K4/L1 reframed as honest read-only + attributed future-backend gaps; hard-constraint note rewritten.
- `docs/23-IMPLEMENTATION-GAPS.md` — section A rewritten; genuine gaps enumerated; test-count corrections.
- `docs/25-INSTITUTIONAL-DATA-IMPORT.md` — new "§0 Source-of-Truth & Demo-Boundary Status (Phase G)" execution note under the Golden Rules.

`docs/archive/` deliberately untouched (historical).