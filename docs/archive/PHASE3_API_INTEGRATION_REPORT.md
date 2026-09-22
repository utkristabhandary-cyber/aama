# PHASE 3: API Integration Report

## 1. Analysis Summary

Phase 3 replaces the frontend mock `store` data architecture with the real Django REST API integration layer for the core academic structure, teacher, and student features.

**What changed (7 services → API-backed):**
- `semesterService.ts` — semesters CRUD via `/academics/semesters/`
- `sectionService.ts` — sections CRUD via `/academics/sections/` (with `?semester=` filter)
- `subjectService.ts` — subjects CRUD via `/academics/subjects/` (with `?semester=` filter)
- `teacherService.ts` — teachers read via `/teachers/` (teachers CRUD is admin-only; UI is read-only list)
- `studentService.ts` — students read via `/students/` (students CRUD is admin-only; UI is read-only list)
- `assignmentService.ts` — teacher assignments via `/academics/assignments/`

**What changed (8 views → store-free, API-backed):**
- `SemestersView.tsx`, `SectionsView.tsx`, `SubjectsView.tsx` — academic CRUD views
- `TeachersView.tsx`, `StudentsView.tsx` — teacher/student list views
- `AssignmentsView.tsx` — teacher course assignment management view
- `AcademicView.tsx` — academic hierarchy overview
- `UserProfileView.tsx` — institutional profile (teacher/student self-view)

**What did NOT change:** Future-phase features (attendance, reports, timetable, notifications, promotion, global search, dashboards) continue to read from `store` — out of scope per Phase 3 objective.

**Backend verification (63 tests):** All pass. `py manage.py check` → 0 issues. `makemigrations --check --dry-run` → no pending migrations.

---

## 2. Files Read

### Frontend (read during this phase)

| File | Why |
|---|---|
| `src/types/index.ts` | Confirmed `TeacherAssignment`, `Teacher`, `Student`, `Semester`, `Section`, `Subject` shapes (string IDs, camelCase) |
| `src/services/apiClient.ts` | Verified methods: `get<T>(url, params?)`, `post<T>`, `patch<T>`, `delete`, `ApiError`, `errorMessage()` |
| `src/services/storage.ts` | Confirmed mock store interface, `aams_storage_change` events, `store.get*`/`save*` signatures |
| `src/components/ui/EmptyState.tsx` | Confirmed `action` object shape (`{ label, onClick, icon? }`) and `ErrorState` props |
| `package.json` | Verified `lint` = `tsc --noEmit`, `build` = `vite build` |
| `backend/apps/academics/views.py` | Confirmed `SemesterViewSet`, `SectionViewSet`, `SubjectViewSet`, `TeacherAssignmentViewSet` (ModelViewSet for all) |
| `backend/apps/academics/serializers.py` | Confirmed `TeacherAssignmentSerializer` fields (`id`, `teacher`, `semester`, `section`, `subject`, `status`, `created_at`) and validation (unique constraint, single-module-per-semester) |
| `backend/apps/teachers/views.py` | Confirmed `TeacherViewSet` with `status`/`department` filters, `AdminOrTeacherRead` permission |
| `backend/apps/students/views.py` | Confirmed `StudentViewSet` with `section`/`semester`/`status` filters, `search` parameter |
| `backend/apps/reports/views.py` | Confirmed `summary` and `by-subject` report endpoints (admin/teacher only) |
| `src/data/initialData.ts` | Confirmed mock data seed IDs (`sem-1`..`sem-4`, `sec-a`..`sec-d`, etc.) — all now unused by migrated views |

### Backend (read in prior audit)

| File | Why |
|---|---|
| `backend/apps/notifications/` | Confirmed model, viewset with `mark_read`/`mark_all_read`, URL patterns |
| `backend/apps/common/urls.py` | Confirmed `/api/health/` endpoint |
| `backend/.env` | Confirmed: `aams_db`, `aams_user`, `127.0.0.1:5432`, `DEBUG=False` |
| `backend/.env.example` | Confirmed: CORS, VITE_API_BASE_URL, token TTL, throttle rates |
| `vite.config.ts` | Confirmed: `@` alias → repo root, file-watch disabled via `DISABLE_HMR` |
| `seed_demo_data.py` | Confirmed: SEM-S4, Section A/B, admin@aams.local, `AaMS@#2026!` |
| `backend/apps/academics/models.py` | Confirmed enums: `SemesterStatus`, `SubjectType`, `SubjectStatus`, `TeacherStatus`, `StudentStatus`, `AssignmentStatus` |

---

## 3. Architectural Constraints

1. **Preserve Phase 2A/2B work** — no weakening of throttling, token handling, or permissions. Verified: `py manage.py test` → 63 pass, `py manage.py check` → 0 issues.

2. **No React Query/SWR/Redux/Zustand** — all async state managed via `useState` + `useEffect`. No new dependencies added.

3. **No UI redesign** — migrated views preserve existing layout, styling, component structure. Functional diffs: loading/error/empty states added.

4. **No destructive DB reseeds** — no changes to `seed_demo_data.py`.

5. **Backend is authoritative** — IDs, relationships, validation, and permissions come from DRF. `sessionStorage` (`aams_auth_token`) remains the sole frontend auth source.

6. **Future phases out of scope** — BSSID/QR redesign, full attendance workflow, timetable consolidation, promotion/import rewrite, notifications redesign, password reset, refresh tokens, capacity testing, ERP integration.

7. **New constraint added**: `src/types/api.ts` is the sole contract between frontend services and DRF. `src/types/index.ts` view models are not modified.

---

## 4. Design Decisions

### Decision 1: Per-domain services, NOT a single `academicService.ts`

The original todo included creating a unified `academicService.ts`. Instead, each domain got its own rewritten service file (`semesterService.ts`, `sectionService.ts`, etc.) because:
- Each maps independently between API and view-model shapes.
- Consumers already import per-domain services directly.
- A single orchestrator would add indirection without meaningful simplification.

**Status:** No `academicService.ts` was created.

### Decision 2: Future-phase stubs return `empty[]`/empty objects, NOT `never`

`teacherService.getCurrentTeacher()`, `getTeacherClasses()`, `getTeacherStudents()`, `getTeacherTimetable()`, `getTeacherReports()`, `studentService.getCurrentStudent()`, `getMyAttendance()`, `getMyTimetable()` were initially stubbed as `Promise<never>`. This broke consumers using `.map()`, `.find()`, and `.length` on the results. Changed to return `any[]` / `{ logs:[], subjects:[], overallPercentage:0 }`.

### Decision 3: Attendance % removed from StudentsView — NOT mocked

The old `getStudentSubjectAttendance()` mock returned hardcoded values. Rather than fake it, the migrated `StudentsView` displays "—" for attendance % and a neutral "available in a later phase" placeholder in the profile modal. Attendance is explicitly a future phase.

### Decision 4: `assignmentService` migrated to API

`assignmentService` was originally left mock-backed. After verification that `/academics/assignments/` provides full CRUD with business-rule validation (duplicate rejection, single-module-per-semester), it was migrated. This ensures `AssignmentsView` is fully API-backed like the other academic views.

### Decision 5: Query params passed as second object to `apiClient.get`

Backend filter parameters (`?semester=`, `?section=`, `?status=`, `?search=`) are passed via `apiClient.get<T>(url, { semester: id })`. This matches the `apiClient` signature without requiring additional abstractions.

### Decision 6: `user` passed to `getCurrentTeacher`/`getCurrentStudent`

`UserProfileView` passes the `user` object from `useAuth()` to `teacherService.getCurrentTeacher(user)` and `studentService.getCurrentStudent(user)`, matching the stub signature `_user: { id?: string; teacherId?: string; email?: string }`. The stub currently ignores this and returns the first record, but the signature is ready for Phase 4+ where backend `/api/auth/me/` or similar endpoint returns scoped data.

---

## 5. Contracts Surfaced

### API Types (`src/types/api.ts`)

| Type | Fields | DRF Source |
|---|---|---|
| `ApiSemester` | `id: number`, `name`, `code`, `academic_year`, `start_date`, `end_date`, `status`, `description` | `SemesterSerializer` |
| `ApiSection` | `id: number`, `name`, `semester: number`, `capacity`, `room` | `SectionSerializer` |
| `ApiSubject` | `id: number`, `code`, `name`, `semester: number`, `credits`, `type`, `status` | `SubjectSerializer` |
| `ApiTeacherAssignment` | `id: number`, `teacher: number`, `semester: number`, `section: number`, `subject: number`, `status`, `created_at` | `TeacherAssignmentSerializer` |
| `ApiTeacher` | `id: number`, `teacher_id`, `name`, `department`, `email`, `phone`, `status` | `TeacherSerializer` |
| `ApiStudent` | `id: number`, `student_id`, `name`, `section: number`, `semester: number`, `roll_no`, `email`, `status` | `StudentSerializer` |
| `ApiErrorPayload` | `{ detail?: string }` or `{ field?: string[] }` | DRF default error format |

### View Models (`src/types/index.ts`) — UNCHANGED

| Type | ID Type | Key Fields |
|---|---|---|
| `Semester` | `string` | `academicYear`, `startDate`, `endDate` |
| `Section` | `string` | `semesterId` |
| `Subject` | `string` | `semesterId` |
| `TeacherAssignment` | `string` | `teacherId`, `semesterId`, `sectionId`, `subjectId` |
| `Teacher` | `string` | `teacherId`, `department`, `designation` |
| `Student` | `string` | `studentId`, `semesterId`, `sectionId`, `rollNo` |

### Backend Endpoints Consumed

| Endpoint | Methods | Views |
|---|---|---|
| `/api/academics/semesters/` | GET, POST | `SemesterViewSet` |
| `/api/academics/semesters/:id/` | GET, PATCH, DELETE | `SemesterViewSet` |
| `/api/academics/sections/` | GET, POST | `SectionViewSet` |
| `/api/academics/sections/:id/` | GET, PATCH, DELETE | `SectionViewSet` |
| `/api/academics/subjects/` | GET, POST | `SubjectViewSet` |
| `/api/academics/subjects/:id/` | GET, PATCH, DELETE | `SubjectViewSet` |
| `/api/academics/assignments/` | GET, POST | `TeacherAssignmentViewSet` |
| `/api/academics/assignments/:id/` | GET, PATCH, DELETE | `TeacherAssignmentViewSet` |
| `/api/teachers/` | GET | `TeacherViewSet` |
| `/api/students/` | GET | `StudentViewSet` |

---

## 6. Command Execution

| Command | Result |
|---|---|
| `npm run lint` (repo root) | `tsc --noEmit` — **0 errors** |
| `npm run build` (repo root) | `vite build` — **built in ~3.08s** |
| `py manage.py check` (backend) | **"System check identified no issues (0 silenced)."** |
| `py manage.py test` (backend) | **63 tests, 0 failures, ~69s** |
| `py manage.py makemigrations --check --dry-run` (backend) | **"No changes detected"** |
| `py manage.py showmigrations --plan` (backend) | **All 29 migrations marked `[X]` (applied)** |

---

## 7. Verifications

### Frontend
- `npm run lint` → clean (0 tsc errors)
- `npm run build` → clean (vite build success, no TypeScript/build failures)
- Unused icon imports removed from `SemestersView`, `SectionsView`, `TeachersView` (all verified via grep)

### Backend
- `py manage.py check` → 0 issues (endpoint wiring, serializer, model integrity)
- `py manage.py test` → 63 pass (academic CRUD, assignment API with business rules, student/teacher APIs, health endpoint, auth flows)
- `py manage.py makemigrations --check --dry-run` → no pending migrations
- `py manage.py showmigrations` → all 29 migrations applied

### Cross-cutting
- No `store` import remains in: `semesterService.ts`, `sectionService.ts`, `subjectService.ts`, `teacherService.ts`, `studentService.ts`, `assignmentService.ts`
- No `store` import remains in: `SemestersView.tsx`, `SectionsView.tsx`, `SubjectsView.tsx`, `TeachersView.tsx`, `StudentsView.tsx`, `AssignmentsView.tsx`, `AcademicView.tsx`, `UserProfileView.tsx`
- `delay()` import removed from all migrated services (no artificial delays)

---

## 8. Migration Payloads

### API→View Model Mappers

| Service | API → View | Key Transformations |
|---|---|---|
| `semesterService` | `ApiSemester → Semester` | `academic_year → academicYear`, `start_date → startDate`, `id: number → String(id)` |
| `sectionService` | `ApiSection → Section` | `semester: number → semesterId: String(semester)`, `id → String(id)` |
| `subjectService` | `ApiSubject → Subject` | `semester: number → semesterId: String(semester)`, `type`/`status` cast from `string` |
| `teacherService` | `ApiTeacher → Teacher` | `teacher_id → teacherId` |
| `studentService` | `ApiStudent → Student` | `student_id → studentId`, `semester → semesterId`, `section → sectionId`, `roll_no → rollNo` |
| `assignmentService` | `ApiTeacherAssignment → TeacherAssignment` | `teacher/semester/section/subject: number → String()` |

### View Model→API Mappers

| Service | View → API | Key Transformations |
|---|---|---|
| `semesterService` | `Semester → ApiSemesterCreate` | `academicYear → academic_year`, `startDate → start_date`, `id` omitted |
| `sectionService` | `Section → ApiSectionCreate` | `semesterId: string → semester: Number(semesterId)` |
| `subjectService` | `Subject → ApiSubjectCreate` | `semesterId → Number(semesterId)` |
| `assignmentService` | `TeacherAssignment → ApiTeacherAssignment` (implicit via `toApi`) | IDs converted via `Number()` |

### Backend Payloads (JSON for create)

```json
// POST /api/academics/semesters/
{
  "name": "Spring 2026",
  "code": "SEM-S4",
  "academic_year": "2026",
  "start_date": "2026-01-01",
  "end_date": "2026-06-30",
  "status": "active",
  "description": "Current semester"
}

// POST /api/academics/sections/
{ "name": "Section A", "semester": 1, "capacity": 60, "room": "Room 101" }

// POST /api/academics/subjects/
{ "code": "CS101", "name": "Intro to CS", "semester": 1, "credits": 4, "type": "Lecture", "status": "active" }

// POST /api/academics/assignments/
{ "teacher": 1, "semester": 1, "section": 1, "subject": 1, "status": "active" }
```

---

## 9. Mapping Correctness

| Mapper | Property Verified | Correct |
|---|---|---|
| `semesterService.toViewModel` | `id: String(api.id)` | ✓ |
| `semesterService.toViewModel` | `academicYear = api.academic_year` | ✓ |
| `semesterService.toViewModel` | `status as SemesterStatus` | ✓ |
| `sectionService.toViewModel` | `semesterId = String(api.semester)` | ✓ |
| `subjectService.toViewModel` | `semesterId = String(api.semester)` | ✓ |
| `subjectService.toViewModel` | `type as SubjectType`, `status as SubjectStatus` | ✓ |
| `teacherService.toViewModel` | `teacherId = api.teacher_id` | ✓ |
| `studentService.toViewModel` | `studentId = api.student_id`, `semesterId = String(api.semester)`, `sectionId = String(api.section)`, `rollNo = api.roll_no` | ✓ |
| `assignmentService.toViewModel` | `teacherId = String(a.teacher)`, etc. | ✓ |
| All `toApi` | `Number(stringId)` for foreign keys | ✓ |

**Note:** Backend enum values (`SubjectType.LECTURE`, `SubjectStatus.ACTIVE`, `SemesterStatus.ACTIVE`, etc.) use `snake_case.choice` in Python. DRF serializes them as `"Lecture"`, `"active"`, etc. (matching `TextChoices.value`). Frontend casts via `as SubjectType` are safe as long as enum strings match.

---

## 10. API Result Reassembly

All services follow the same reassembly pattern:

```
apiClient.get<ApiType[]>(url, params?)
  → list.map(toViewModel)
  → returned to consumer as ViewModelType[]
```

For single-resource endpoints:

```
apiClient.get<ApiType>(`${url}/${id}/`)
  → toViewModel(data)
  → returned as ViewModelType | undefined
```

**Error handling:** Consumers display errors via `errorMessage(err)` (extracts DRF error detail). Views show error banners with a retry button. No graceful degradation / retry logic — errors are surfaced immediately.

**Loading states:** All migrated views add `isLoading` state, set `true` before API call, `false` in `finally` block. Error states use a red banner with retry. Empty states show when data arrays are empty post-loading.

---

## 11. Cleanup Summary

### Removed from services
- `import { store } from './storage'` — removed from `semesterService`, `sectionService`, `subjectService`, `teacherService`, `studentService`, `assignmentService`
- `import { delay } from './authService'` — removed from all (no more artificial delays)
- `import { assertTeacherSingleModulePerSemester } from './academicRules'` — removed from `assignmentService` (now enforced by DRF serializer validation)

### Removed from views
- `import { store } from '../../services/storage'` — removed from `SemestersView`, `SectionsView`, `SubjectsView`, `TeachersView`, `StudentsView`, `AssignmentsView`, `AcademicView`, `UserProfileView`
- `aams_storage_change` event listeners — removed from all migrated views (no longer using store events)
- Unused icon imports cleaned: `Layers`, `BookOpen`, `Users`, `Eye` from `SemestersView`; `Users` from `SectionsView`; `BookOpen`, `Calendar`, `Layers` from `TeachersView`

### Removed from `academicRules.ts`
- No changes (still imported by other future-phase services like `sectionAllocationService`)

### `store` accessors still used (future-phase views only)
- `Header.tsx` → unread notifications count
- `GlobalSearchModal.tsx` → student/teacher search
- `AdminDashboard.tsx` → stat card counts
- `AcademicView.tsx` → **REMOVED** (migrated)
- `AssignmentsView.tsx` → **REMOVED** (migrated)
- `TakeAttendanceView.tsx`, `AttendanceAdminView.tsx` → attendance (future)
- `ReportsView.tsx`, `ReportModal.tsx` → reports (future)
- `TimetableAdminView.tsx`, `ExportTimetableModal.tsx` → timetable (future)
- `NotificationsView.tsx` → notifications (future)
- `PromotionView.tsx` → promotion (future)
- `SectionAllocationCSVView.tsx` → allocation CSV (future)
- `StudentDashboard.tsx`, `StudentAttendanceView.tsx`, `StudentTimetableView.tsx`, `StudentReportsView.tsx`, `StudentProfileView.tsx`, `StudentAttendanceHistoryView.tsx`, `StudentQRScannerView.tsx` → student-side (future)
- `TeacherDashboard.tsx`, `TeacherClassesView.tsx`, `TeacherTimetableView.tsx` → teacher-side (future)
- `SettingsView.tsx`, `UserProfileView.tsx` → settings (profile migrated; settings still mock)

---

## 12. storageIdRemoval Check

**Not in scope.** The frontend view model types (`Semester`, `Section`, `Subject`, etc.) retain their `string` IDs for internal state management. ID removal (migrating from string to numeric) is a future-phase concern.

IDs in migrated views: all now come from the API via `String(api.id)`. No view generates synthetic `sem-1` or `sec-a` format IDs.

---

## 13. Auth / sessionStorage Update

**No changes.** Auth flow remains:
1. `AuthService.login()` → POST `/api/auth/login/` → receive token
2. Token stored in `sessionStorage` as `aams_auth_token`
3. `apiClient` reads token and attaches as `Authorization: Token <token>`
4. Token cleared on logout

The `useAuth()` hook continues to provide `user`/`role` to views. `UserProfileView` passes `user` to `teacherService.getCurrentTeacher(user)` / `studentService.getCurrentStudent(user)` — the stub accepts the user object but currently ignores it (returns first record from list).

---

## 14. Mock Store Cleanup

**Partial — scoped to Phase 3 consumers only.**

- `storage.ts` (mock store) is NOT removed or modified. It remains the data source for 26+ future-phase views.
- `initialData.ts` (mock seed data) is NOT removed. It remains the fallback data for `storage.init()`.

**Migrated consumers:** The 8 migrated views no longer import or call `store`. On fresh API-backed data load, these views show API data exclusively.

**Future-phase consumers** (26 files still import `store`): Dashboards, attendance, reports, timetable, notifications, promotion, settings, student/teacher sub-views. These will be migrated in Phase 4+.

---

## 15. tsc / Lint / Build

| Check | Status |
|---|---|
| `npm run lint` (`tsc --noEmit`) | **0 errors** |
| `npm run build` (`vite build`) | **success** (built in ~3.08s, 817KB JS bundle, 71KB CSS) |
| Bundle size warning | Chunks > 500KB (pre-existing, not introduced by Phase 3) |

**Unused imports cleaned post-migration:**
- `SemestersView.tsx`: `Layers`, `BookOpen`, `Users`, `Eye`
- `SectionsView.tsx`: `Users`
- `TeachersView.tsx`: `BookOpen`, `Calendar`, `Layers`

---

## 16. Production Build Output

```
vite v6.4.3 building for production...
1802 modules transformed.
dist/index.html                 1.26 kB │ gzip: 0.55 kB
dist/assets/index-qzVh58AQ.css 71.69 kB │ gzip: 11.58 kB
dist/assets/index-C2ZU0i74.js 817.61 kB │ gzip: 219.09 kB
built in 3.08s
```

No runtime JS errors expected: all migrated services return typed Promises resolved via `apiClient`. Error paths return `ApiError` instances caught and displayed as error banners in views.

---

## 17. Commentary

### What went well
- The `apiClient` abstraction provided a clean, consistent HTTP layer. All services follow the same `get/post/patch/delete` + `toViewModel` pattern without variation.
- DRF serializers closely mirror the original frontend `initialData.ts` shapes, making `toViewModel` mappers minimal (mostly string/number conversion and camelCase mapping).
- Backend's `TeacherAssignmentViewSet` (ModelViewSet) provides full CRUD out of the box with validation (unique constraint, single-module-per-semester), meaning `assignmentService` got the same treatment as other services without needing special endpoints.
- `npm run lint` is `tsc --noEmit` only — unused imports do NOT cause failures, but were cleaned manually for code hygiene.

### What was unexpectedly difficult
1. **`Promise<never>` stubs broke consumers** — returning `never` from async stubs caused `Property 'map' does not exist on type 'never'` errors in views using `.map()`. Fix: return `any[]` / empty objects.
2. **JSX expression comments** — placing `{/* comment */}` inside a conditional expression `{expr && (... <Card>...</Card> )}` caused TS parser errors. Fix: remove comment or restructure expression.
3. **`EmptyState` prop shape** — `actionLabel`/`onAction` props don't exist; the correct shape is `action: { label, onClick }`. Easy to miss since other components use `actionLabel`.

### Known residual `store` consumers (future-phase)
The following views still import `store` and will need migration in Phase 4+:
- `AdminDashboard.tsx` — stat card counts (students, teachers, semesters, sections, subjects)
- `Header.tsx` — unread notifications count
- `GlobalSearchModal.tsx` — student/teacher text search
- `SectionAllocationCSVView.tsx` — CSV import allocation (uses `store.getSemesters`, `store.getSections`, `store.getStudents`)
- All attendance/timetable/report/promotion/settings views

### Future work
1. **Backend `/api/auth/me/` endpoint** — enables `getCurrentTeacher(user)` / `getCurrentStudent(user)` to resolve from token rather than returning first-list-record.
2. **Pagination** — `apiClient.get` returns full lists; for 100+ records, add DRF pagination support.
3. **Assignment validation messaging** — DRF returns structured validation errors (e.g., `{ teacher: ["..."] }`); current `errorMessage()` extracts the first value, but could be richer.
4. **`assignmentService.toApi` export** — defined but unused (create endpoint receives raw IDs, not mapped objects). Could be useful if AssignmentsView form logic evolves.

---

*Report generated: 2026-09-06*
*Phase: 3 of 6 — API Integration (Academic Structure, Teachers, Students)*
*Backend tests: 63 passing | Frontend: tsc clean, vite build clean*
