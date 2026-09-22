# AAMS — Frontend ↔ Django Backend Integration Audit

Date: 2026-09-06 · Mode: **AUDIT ONLY** · No source, schema, migration, or data changes were made.

---

## 1. Executive Summary

1. **The frontend and backend are completely disconnected.** Every one of the ~20 frontend services (except `apiClient.ts`) reads/writes a singleton localStorage store (`aams_data_v1_*`) seeded from `src/data/initialData.ts`. `src/services/apiClient.ts` — a working DRF fetch client — is **orphaned**: a repo-wide grep finds `apiClient` referenced only in its own definition, and the only `fetch()` in the entire `src/` lives inside it, never called.
2. **There is no live authentication.** `authService.login` (authService.ts:30-45) matches an email against localStorage-mock users and **ignores the password**; it never calls `/api/auth/login/`. The stored token is a fabricated string `mock-jwt-token-<role>-<ts>` (authService.ts:25,40,53) that DRF `TokenAuthentication` would reject with 401. The Authentication mechanism is therefore **not a Bearer-vs-Token mismatch; it is mock-vs-real**.
3. **The QR protocol is the closest to "just wire it up."** The frontend payload scheme `AAMSQR1|<session-id>|<TOKEN>` (qrPayload.ts) and 8-char `XXXX-XXXX` token alphabet (qrAttendanceService.ts:27-32) match the backend byte-for-byte (attendance/services.py:36-38, models.py:22-33). But the real scan→validate→mark flow is fully in-browser against localStorage under `aams_active_qr_sessions_v1`; the equivalent DRF endpoints (`/api/attendance/qr/*`) are never called.
4. **The backend has several real authorization vulnerabilities** regardless of frontend integration: `AttendanceRecordViewSet` and the QR viewset have only the global `IsAuthenticated` default, `mark`/`submit` actions on attendance sessions have **no teacher-ownership check**, and QR `mark` accepts an arbitrary `studentId` with no section-membership check while the live token is returned by `GET /api/attendance/qr/<id>/` (readable by any authenticated user including students). Phase 1's QR/attendance groundwork is sound (UNMARKED semantics, single-module rule, timetable conflicts all tested), but the API surface is **not safe to expose to a connected UI as-is**.
5. **Several features have no honest backend equivalent at all** (promotion, timetable import pipeline, institution settings, dashboard aggregates, backup/restore), and the import pipeline fabricates its output (hardcoded `analyzeFile` results, fallback mapping to `sec-1a`), so the "connected to PostgreSQL" copy in that wizard is false marketing.

**Net:** Frontend functionality backed by Django/PostgreSQL today ≈ **0%**. Phase 1 itself remains intact and green (lint, build, 21/21 backend tests, all migrations applied) — but as a localStorage demo, not as a client of the new backend.

---

## 2. Repository Architecture

```
aams-—-academic-attendance-management-system/
├── .env                       # Real DB creds (never committed; no .git present)
├── .env.example               # Stale Gemini/AI-Studio template; Django vars commented out
├── package.json               # Vite 6, React 19, TS ~5.8; lint = tsc --noEmit
├── tsconfig.json              # ESNext/bundler; no react-router dependency
├── src/                       # ← FRONTEND ROOT
│   ├── main.tsx, App.tsx      # entry; App.tsx = state-based router + role guards
│   ├── index.css
│   ├── types/index.ts         # all TS entity types
│   ├── data/initialData.ts    # hardcoded seeds (users…teaching sessions)
│   ├── context/{AuthContext,ToastContext}.tsx
│   ├── services/              # 20 files, ALL localStorage/mock EXCEPT apiClient.ts
│   └── features/, components/ # views + UI kit (+ layout)
└── backend/                   # ← BACKEND ROOT (Django 5.2.17 + DRF 3.18)
    ├── manage.py
    ├── config/{settings/{base,development}.py, urls.py, exceptions.py, asgi.py}
    ├── requirements/{base,development}.txt
    └── apps/{accounts, academics, teachers, students, attendance,
              notifications, reports, common}/   # models/serializers/views/urls/services/tests
```

- There is **no git repository** (`.git` absent). There is **no react-router** — navigation is a `viewId` string in `useState` dispatched through a switch in `App.tsx:151-278`.
- Backend settings: DRF `TokenAuthentication` + `SessionAuthentication` (`backend/config/settings/base.py:138-145`), global default permission `IsAuthenticated` (base.py:144), global `PageNumberPagination` `PAGE_SIZE=100` (base.py:150-151), custom exception handler (`config/exceptions.py`).

---

## 3. Current Frontend Architecture

- **Routing/guards:** state-based, no router. `VIEW_ROLE_PERMISSIONS` (App.tsx:50-85) maps viewId→roles; guard logic at App.tsx:127-148; `UnauthorizedAccessView.tsx:41` itself states that production enforcement "must be validated by Django REST Framework" — currently the client-side role check is the **only** enforcement.
- **Data flow:** `DataStore` in `src/services/storage.ts` (prefix `aams_data_v1_`) is initialized from `INITIAL_*` arrays in `initialData.ts` on first load, then all mutations are `localStorage` write-through. All 19 domain services wrap `store` with `delay()`.
- **Auth:** `AuthContext` calls `authService`; default behavior auto-logs-in the first mock admin if nothing stored (authService.ts:21-27). Password never verified.
- **QR:** real `qrcode` encoder in `TakeAttendanceView` (renders `AAMSQR1|...`), real `jsQR` decoder + `getUserMedia` in `StudentQRScannerView`; token/session state in `aams_active_qr_sessions_v1` (localStorage) with window-event fan-out between teacher/student tabs (same browser).
- **Dashboard statistics** are a mix of localStorage-derived counts and hardcoded/fabricated numbers (see §19).

---

## 4. Current Backend Architecture

- 8 apps wired in `config/urls.py` under `/api/<app>/`. Migrations all applied (27/27 `[X]`); `py manage.py check` → 0 issues; **21/21 tests pass**.
- `accounts` — User (email login, `Role` admin/teacher/student), login/logout/me, permission helpers (`IsAdminUser`, `IsTeacherUser`, `IsStudentUser`, `IsAdminOrTeacher`, `ReadOnly`, `AdminOrReadOnly`).
- `academics` — Semester, Section (unique semester+name), Subject (unique semester+code), Holiday, TeacherAssignment (unique teacher+semester+section+subject; single-module rule), TimetableSlot (+`sections` M2M, `is_combined`, conflict checks), TeachingSession (+`sections` M2M).
- `teachers` / `students` — profiles with unique `teacher_id`/`student_id`, section↔semester consistency in `Student.clean`.
- `attendance` — AttendanceSession (`sections` M2M, JSON `attendance_ids`/`marked_ids`, `is_finalized`), AttendanceRecord (unique session+student; **absence of a row = UNMARKED, never auto-Present**), QRAttendanceSession (15s TTL, one active per teacher via partial unique index, `AAMSQR1|<id>|<TOKEN>` payload). Services in `attendance/services.py`.
- `notifications` — recipient-scoped ReadOnly viewset + mark_read/mark_all_read (correctly scoped).
- `reports` — `summary`, `by-subject`, `students_at_risk` (no section/student/teacher scope).
- `common` — `GET /api/health/` (AllowAny, DB check), idempotent `seed_demo_data` (password `AaMS@#2026!`; demo logins admin@aams.local / r.prof@aams.local / students).

---

## 5. Complete API Inventory

Derived from `config/urls.py`, app `urls.py`, serializers, views, and tests. Auth: all endpoints require `Authorization: Token <key>` unless noted. Permission: role gate.

| Method | Path | Auth | Role/Permission | Request | Response (key fields) | DB effect | Tests |
|---|---|---|---|---|---|---|---|
| GET | /api/health/ | **No** | AllowAny | — | {status, database, message} | read (SELECT 1) | ✅ accounts |
| POST | /api/auth/login/ | No | AllowAny | email, password | {token, user} | read/verify | ✅ |
| POST | /api/auth/logout/ | Y | IsAuthenticated | — | 204 | **delete token** | ❌ |
| GET | /api/auth/me/ | Y | IsAuthenticated | — | Me{id,name,email,role,avatar,dept,teacher_id,student_id,semester_id,section_id} | read | ❌ |
| GET/POST | /api/academics/semesters/ | Y | AdminOrReadOnly (writes=admin) | Semester fields | Semester | read/create | ⚠️ partial |
| GET/PUT/PATCH/DELETE | /api/academics/semesters/{id}/ | Y | AdminOrReadOnly | — | Semester | read/update/delete | ❌ |
| GET/POST | /api/academics/sections/ | Y | AdminOrReadOnly | name, semester, capacity, room | SectionDetail(+semester_code) | read/create | ❌ |
| GET/PUT/PATCH/DELETE | /api/academics/sections/{id}/ | Y | AdminOrReadOnly | — | — | read/update/delete | ❌ |
| GET/POST | /api/academics/subjects/ | Y | AdminOrReadOnly | code,name,semester,credits,type,status | Subject | read/create | ✅ (create+403) |
| GET/PUT/PATCH/DELETE | /api/academics/subjects/{id}/ | Y | AdminOrReadOnly | — | — | read/update/delete | ❌ |
| GET/POST | /api/academics/assignments/ | Y | AdminOrReadOnly | teacher,semester,section,subject,status | TeacherAssignment | read/create | ✅ (dup/diff-subject rejected) |
| GET/PUT/PATCH/DELETE | /api/academics/assignments/{id}/ | Y | AdminOrReadOnly | — | — | read/update/delete | ⚠️ |
| GET/POST | /api/academics/timetable/ | Y | AdminOrReadOnly | semester,section,section_ids,subject,teacher,day,start,end,room,class_type,notes | TimetableSlot(+is_combined) | read/create | ❌ (service-tested) |
| GET/PUT/PATCH/DELETE | /api/academics/timetable/{id}/ | Y | AdminOrReadOnly | — | — | read/update/delete | ❌ |
| GET/POST | /api/academics/teaching-sessions/ | Y | AdminOrReadOnly | semester,subject,teacher,class_type,section_ids,day,start,end,room,notes | TeachingSession(+is_combined) | read/create | ❌ |
| GET/PUT/PATCH/DELETE | /api/academics/teaching-sessions/{id}/ | Y | AdminOrReadOnly | — | — | read/update/delete | ❌ |
| GET/POST | /api/academics/holidays/ | Y | AdminOrReadOnly | date,title,description,type | Holiday | read/create | ❌ |
| GET/PUT/PATCH/DELETE | /api/academics/holidays/{id}/ | Y | AdminOrReadOnly | — | — | read/update/delete | ❌ |
| GET/POST | /api/teachers/ | Y | AdminOrReadOnly | all Teacher fields | Teacher | read/create | ❌ |
| GET/PUT/PATCH/DELETE | /api/teachers/{id}/ | Y | AdminOrReadOnly | — | — | read/update/delete | ❌ |
| GET/POST | /api/students/ | Y | AdminOrReadOnly | student_id,roll_no,name,email,phone,section,…status | Student(+section/semester names) | read/create | ❌ |
| GET/PUT/PATCH/DELETE | /api/students/{id}/ | Y | AdminOrReadOnly | — | — | read/update/delete | ❌ |
| GET | /api/attendance/sessions/ | Y | ReadOnly (any auth) | — | list sessions (teacher-scoped only for non-staff teachers) | read | ❌ |
| POST | /api/attendance/sessions/ | Y | **IsTeacherUser** | session_date,subject,phase,start_time,planned_end_time,section_ids,teaching_session | AttendanceSession | create | ❌ |
| GET | /api/attendance/sessions/{id}/ | Y | ReadOnly | — | session | read | ❌ |
| PUT/PATCH | /api/attendance/sessions/{id}/ | Y | IsTeacherUser | — | session | update | ❌ |
| DELETE | /api/attendance/sessions/{id}/ | Y | IsTeacherUser | — | 204 | delete | ❌ |
| POST | /api/attendance/sessions/{id}/mark/ | Y | **IsTeacherUser (no ownership check)** | studentId/student, status | AttendanceRecord | create/update record | ⚠️ service-tested |
| GET | /api/attendance/sessions/{id}/roll/ | Y | ReadOnly | — | {attendanceSessionId, students[]} | read | ⚠️ service-tested |
| POST | /api/attendance/sessions/{id}/submit/ | Y | **IsTeacherUser (no ownership check)** | markedIds, lateReason | session(submitted_at) | **finalize** | ✅ service-tested |
| GET/POST | /api/attendance/records/ | Y | **IsAuthenticated only (no restriction)** | any record fields | list/create | read/create | ❌ |
| PUT/PATCH/DELETE | /api/attendance/records/{id}/ | Y | **IsAuthenticated only** | — | — | update/delete | ❌ |
| GET/POST | /api/attendance/qr/ | Y | **IsAuthenticated only** | — | list/create QR | read/create | ❌ |
| GET/PUT/PATCH/DELETE | /api/attendance/qr/{id}/ | Y | **IsAuthenticated only** | — | QR incl. **token + payload** | read/update/delete | ❌ |
| POST | /api/attendance/qr/start/ | Y | IsAuthenticated (no IsTeacherUser) | attendanceSessionId | QR (+payload) | create/rotate QR | ✅ service-tested |
| POST | /api/attendance/qr/{id}/validate/ | Y | IsAuthenticated | code | {valid, message, payload} | read (may rotate token) | ✅ service-tested |
| POST | /api/attendance/qr/{id}/mark/ | Y | **IsAuthenticated (no student check)** | code, studentId, status | AttendanceRecord | create/update record | ⚠️ service-tested |
| POST | /api/attendance/qr/{id}/stop/ | Y | IsAuthenticated | — | {detail} | **revoke** | ❌ |
| GET | /api/notifications/ | Y | IsAuthenticated (scoped to recipient) | — | list | read | ❌ |
| GET | /api/notifications/{id}/ | Y | IsAuthenticated (scoped) | — | Notification | read | ❌ |
| POST | /api/notifications/{id}/mark_read/ | Y | IsAuthenticated (scoped) | — | Notification | update is_read | ❌ |
| POST | /api/notifications/mark_all_read/ | Y | IsAuthenticated (scoped) | — | {detail} | update | ❌ |
| GET | /api/reports/summary/?semester= | Y | IsAuthenticated+AdminOrReadOnly | — | {semester,totalAttendanceSessions,totalMarked,present,late,absent,attendancePercentage,totalStudents,studentsAtRisk[]} | read | ❌ |
| GET | /api/reports/by-subject/?semester= | Y | IsAuthenticated+AdminOrReadOnly | — | [{subjectId,subjectName,total,present,percentage}] | read (semester param **ignored**) | ❌ |

**Gaps:** no signup; students can't read their own attendance scope (list is teacher-scoped or totally open, never student-scoped); no per-student/per-teacher/per-section report scope; no page overrides (PAGE_SIZE=100 truncates big rosters); `AttendanceRecord`/`QR` viewsets missing any role restriction.

---

## 6. Frontend Service → API Mapping

Matrix of **every** service/function in `src/services`. Evidence = file:line.

| Frontend service/function | Storage | Backend endpoint | Status | Evidence |
|---|---|---|---|---|
| `authService.getCurrentUser/login/loginAsRole/logout/getToken` | localStorage (users + `aams_auth_token`) | `/api/auth/login/` exists; **never called** | **MOCK/FAKE** (password ignored, token fabricated) | authService.ts:25,30-45,40,53 |
| `apiClient` (get/post/patch/put/delete/login/me/logout) | localStorage `aams_auth_token` | full DRF client | **API EXISTS BUT FRONTEND NOT CONNECTED (orphaned)** | apiClient.ts:108; zero imports repo-wide |
| `storage.DataStore` (all getters/setters) | localStorage `aams_data_v1_*` | — | LOCALSTORAGE ONLY | storage.ts:32-53,58-79 |
| `timetableService` | store | `/api/academics/timetable/` | LOCALSTORAGE ONLY | timetableService.ts |
| `timetableApi.*` (incl. import pipeline) | store | timetable/teaching+`confirmImport` has **no** backend | MOCK/FAKE (+ hardcoded analyze) | timetableApi.ts:173-291,334-837 |
| `teacherService` | store (+ synthesizes teaching sessions) | `/api/teachers/`, `/api/academics/teaching-sessions/` | LOCALSTORAGE ONLY | teacherService.ts:55-102,61-75 |
| `subjectService` / `semesterService` / `sectionService` | store | `/api/academics/subjects·semesters·sections/` | LOCALSTORAGE ONLY | subjectService/semesterService/sectionService.ts |
| `sectionAllocationService` | store/in-memory | — | LOCALSTORAGE ONLY (CSV parse) | sectionAllocationService.ts |
| `studentService` | store (92%/90% fallbacks) | `/api/students/` | LOCALSTORAGE ONLY | storage.ts:379,416 |
| `assignmentService` (+ academicRules) | store | `/api/academics/assignments/` | LOCALSTORAGE ONLY (rules are real logic) | assignmentService.ts,academicRules.ts |
| `attendanceService` | store | `/api/attendance/sessions/` (mark/roll/submit) | LOCALSTORAGE ONLY | attendanceService.ts |
| `qrAttendanceService` | localStorage `aams_active_qr_sessions_v1` | `/api/attendance/qr/*` (payload **already matches**) | LOCALSTORAGE ONLY | qrAttendanceService.ts:6-21,35-97,233-268 |
| `qrPayload` (encode/decode) | none | — | **MATCHES BACKEND** (pure funcs) | qrPayload.ts:16-24 |
| `reportService` | store (88% fallback) | `/api/reports/summary/`,`by-subject/` | LOCALSTORAGE ONLY | reportService.ts:49-219; ReportsView.tsx:95 |
| `promotionService` | store + `aams_data_v1_promotions` | **none exists** | FRONTEND EXISTS BUT API MISSING | promotionService.ts; backend grep=0 |
| `notificationService` | store | `/api/notifications/` | LOCALSTORAGE ONLY (targeting cosmetic) | notificationService.ts:26-45 |
| `holidayService` | store | `/api/academics/holidays/` | LOCALSTORAGE ONLY | holidayService.ts |
| `authService` seed user defaults | localStorage | — | HARDCODED auto-login | authService.ts:21-27 |
| `academicRules` | store | mirrors `academics/services.py` | LOCALSTORAGE ONLY (rules duplicated, correct) | academicRules.ts:23-38 |

Statuses used: **0** FULLY INTEGRATED · **0** PARTIALLY INTEGRATED · **1** API-EXISTS-BUT-UNUSED (apiClient) · **18** LOCALSTORAGE ONLY · **4** MOCK/FAKE (auth, timetableApi import, dashboard fallbacks, defaulter dispatch toast) · **n/a** HARDCODED (dashboards, initialData, analyzeFile).

---

## 7. Authentication Analysis — **MISMATCH: MOCK vs REAL (Severity P0)**

| Aspect | Frontend | Backend | Match? |
|---|---|---|---|
| Scheme | `Authorization: Token <mock>` (apiClient.ts:87 — correct scheme, wrong value) | DRF `TokenAuthentication` (base.py:138-142) | Header scheme ✅; value ❌ |
| Login call | `authService.login` — localStorage lookup, **password ignored** (authService.ts:30-45) | `POST /api/auth/login/` verifies password → `{token,user}` (accounts/views.py:11-33) | ❌ frontend never calls it |
| Token value | `mock-jwt-token-<role>-<ts>` (authService.ts:25,40,53) | real random `Token.key` | ❌ fabricated → 401 |
| Auto-login | silent admin default (authService.ts:21-27) | — | ❌ |
| Logout | clears localStorage only (authService.ts:60-65); apiClient.logout never calls backend (apiClient.ts:126-128) | `POST /api/auth/logout/` deletes server token (accounts/views.py:36-40) | ❌ no server revoke |
| 401 handling | none (apiClient throws ApiError, no redirect/clear) | — | ❌ |
| Role storage | `aams_current_user` (spoofable in DevTools; role switcher in Header.tsx:151-173) | server-side via token→user | ❌ |

**Classification:** P0. The backend login/token flow is real and correct; the UI simply never calls it. The word "JWT" in mock tokens is a red herring — the mismatch is mock-versus-real, and the `Authorization: Token` header shape is already right.

---

## 8. Admin Integration Matrix

| Admin workflow | Frontend impl | Backend impl | Integration status | Evidence |
|---|---|---|---|---|
| Semester CRUD | localStorage | Semesters viewset | LOCALSTORAGE ONLY | SemestersView; academics/views.py |
| Section CRUD | localStorage | Sections viewset | LOCALSTORAGE ONLY | SectionsView |
| Subject CRUD | localStorage | Subjects viewset (dup→400) | LOCALSTORAGE ONLY | SubjectsView; tests pass |
| Teacher management | localStorage | Teachers viewset | LOCALSTORAGE ONLY | TeachersView |
| Student management | localStorage | Students viewset (semester auto-derived) | LOCALSTORAGE ONLY | StudentsView; students/serializers.py:48-58 |
| Teacher assignment | localStorage + single-module rule | Assignments viewset (rule enforced) | LOCALSTORAGE ONLY (rule parity correct on both) | AssignmentsView; academics/services.py:74-105 |
| Timetable | localStorage + conflict checks | Timetable viewset (conflicts enforced) | LOCALSTORAGE ONLY | TimetableAdminView; services.py:108-192 |
| Teaching sessions | localStorage | TeachingSession viewset | LOCALSTORAGE ONLY | teacherService.ts:61-75 |
| Attendance history | localStorage | sessions list (read) | LOCALSTORAGE ONLY | AttendanceAdminView |
| Reports | localStorage (+92% fallback) | reports endpoints (open to students) | LOCALSTORAGE ONLY | ReportsView; storage.ts:379 |
| Holidays/calendar | localStorage | Holiday viewset | LOCALSTORAGE ONLY | CalendarHolidaysView |
| Notifications broadcast | mock toast; `target` dropped | recipient-scoped viewset | LOCALSTORAGE ONLY / MOCK targeting | NotificationsView.tsx:70-98 |
| Promotion | localStorage; no archival | **NONE** | FRONTEND EXISTS BUT API MISSING | PromotionView; backend grep=0 |
| Import | **fake** (hardcoded) | no import endpoint | **MOCK/FAKE** | timetableApi.ts:173-291,727-837 |
| Export | CSV/JSON blobs; omits some collections | none | LOCALSTORAGE ONLY | storage.ts:471-487 |
| Reset | `localStorage.clear()` reseed | n/a (client-only) | LOCALSTORAGE ONLY (+ latent reset bug, §20) | storage.ts:519-539 |

---

## 9. Teacher Integration Matrix — **all "NO — localStorage"**

Teacher login → mock. Teacher dashboard → localStorage + hardcoded `89` + fixed date. Assigned classes/subjects → synthesized from localStorage (`teacherService.ts:61-75`). Timetable → localStorage. Manual attendance → localStorage (`TakeAttendanceView.tsx:318-344,397-411`). QR attendance → localStorage same-browser (`qrAttendanceService.ts`). Student roster → localStorage. Reports → localStorage (`TeacherReportsView`). Profile → localStorage (wrong-profile bug, §20). Notifications → localStorage.
**Answer to "does this ultimately persist/read from PostgreSQL?" for every teacher operation: NO — localStorage/mock.**

---

## 10. Student Integration Matrix — **all "NO — localStorage"**

Student login → mock (ignores password). Profile/semester/section → localStorage (`StudentProfileView`; profile lookup by mismatched id). Timetable → localStorage. QR scanning → real `jsQR` decode of a **locally stored** QR session (`StudentQRScannerView.tsx:102-144`; `submitStudentAttendance` resolves against `aams_active_qr_sessions_v1`). Attendance history/reports → localStorage. Notifications → localStorage.

**QR answer:** the chain `Student UI → jsQR → frontend service → (API client) → Django → PostgreSQL` **does not occur**. It ends at `qrAttendanceService.submitStudentAttendance` (qrAttendanceService.ts:163-231) mutating localStorage. The chain is severed at "frontend service" — no HTTP request is made anywhere in the student path.

---

## 11. Attendance Integration Trace (manual)

| Step | Layer | Status | Evidence |
|---|---|---|---|
| Select teaching session | FE store (synthesized from assignments) | FRONTEND-ONLY | teacherService.ts:55-102 |
| Load roster (incl. combined) | FE `store.getStudentsBySection`, dedupe | FRONTEND-ONLY | TakeAttendanceView.tsx:188-202 |
| Mark P/A/L | FE local `records` state | FRONTEND-ONLY | TakeAttendanceView.tsx:318-344 |
| Holiday block | FE `store.getHolidays()` + fixed date | FRONTEND-ONLY | TakeAttendanceView.tsx:479-495 |
| Submit persist | FE `store.saveAttendanceSession` | FRONTEND-ONLY | TakeAttendanceView.tsx:397-411 |
| **Backend twin** | DRF `AttendanceSessionViewSet` mark/roll/submit | **exists, never called** | attendance/views.py:57-90 |

UNMARKED semantics parity: manual/роster path leaves unmarked students with no record on the **frontend** (TakeAttendanceView.tsx:198-202) and no `AttendanceRecord` row on the **backend** (models.py:89-92, services.py:88-107) — they agree on "never auto-Present". **Exception:** the frontend **QR** path initializes every student to `absent` (qrAttendanceService.ts:66) and persists that map on finalize, so QR-originated sessions fabricate `absent` rows for unmarked students — **diverges from backend semantics** (backend would keep them record-less).

---

## 12. QR Integration Trace

| Step | Actual layer | Status |
|---|---|---|
| Teacher starts session | FE `qrAttendanceService.startQRSession` → localStorage + window event | FRONTEND-ONLY |
| QR rendered | real `qrcode` lib, payload `AAMSQR1|<id>|<TOKEN>` | FRONTEND-ONLY (format = backend) |
| 15s rotation | FE timer + `rotateToken` | FRONTEND-ONLY |
| Student scan | real `jsQR` + `getUserMedia`, token matched against localStorage | FRONTEND-ONLY |
| Validate/mark | FE `submitStudentAttendance` (checks section membership locally) | FRONTEND-ONLY |
| Finalize | FE `finalizeQRSession` → `store.saveAttendanceSession` | FRONTEND-ONLY |
| Backend twin | `qr/start|validate|mark|stop`, `start_qr_session/validate_qr/mark_qr_student` | exists, never called |

**The token/payload protocol is already interoperable** (same prefix, same token format, same alphabet — qrPayload.ts:16-24 vs attendance/services.py:36-38). What's missing is purely the network wiring plus (required, for safety) backend authorization hardening (§21).

---

## 13. BSSID / Network Verification — Architectural Readiness (NO implementation)

What must be built **before** BSSID/network verification is safe (all currently absent):
1. QR `mark` server-side student authorization (student ∈ session sections) and per-student one-time-code binding (today token is shared/replayable).
2. Teacher-ownership validation on QR `start` and session `mark`/`submit`.
3. Session fields to anchor the *teacher's* network context (the current `AttendanceSession` holds no network columns).

Where it would attach (logical fit, not implemented):
- **Model anchor:** `AttendanceSession` (holds the session lifecycle and `is_finalized` gate; the network policy must gate marks for its lifetime). Room field is absent on the backend model today. `AttendanceRecord` is the natural place for per-student verification metadata (e.g. verified/device id) — but those are new fields, not created here.
- **API enforcement points:** `POST /api/attendance/sessions/{id}/mark/` (teacher manual) and `POST /api/attendance/qr/{id}/mark/` (student check-in) — network policy would validate the requester's device context against the session's anchored network SSID/BSSID.
- **Readiness verdict:** the architecture supports adding it cleanly **after** the authorization hardening above (the mark paths are already centralized in `mark_qr_student`/`finalize_attendance_session`). Browser `getUserMedia` works; but the frontend cannot read BSSID/SSID (browsers never expose them) — so the design must rely on **server-observed request metadata** (remote IP, TLS/`Sec-*` hints) or a **companion device/proxy**, never the browser. That is the key platform limitation to design around. Frontend-only "network check" today is impossible in-browser.

---

## 14. TimetableSlot vs TeachingSession

Both models exist independently on the **backend** and are **not auto-synced** anywhere:

| | TimetableSlot (academics/models.py:195-244) | TeachingSession (academics/models.py:247-293) |
|---|---|---|
| Role | Scheduled class slot (what/concrete) | Recurring teaching block a teacher owns |
| Primary section | `section` FK + `sections` M2M | `sections` M2M (no single FK) |
| `day` | required | blankable |
| Conflicts | `check_timetable_conflicts` (services.py:108-192) | single-module rule only |
| API | `/api/academics/timetable/` | `/api/academics/teaching-sessions/` |
| Attendance link | **none** — AttendanceSession.teaching_session FK → **TeachingSession only** (verified via field introspection) | AttendanceSession FK source |
| Teacher "My Classes" (FE) | not used | synthesized in teacherService.ts:61-75 (localStorage) |

Frontend keeps **both** notions too (`TimetableSlot` & `TeachingSession` types/collections; `AttendanceSession.timetableSlotId?` **and** `.teachingSessionId?`). `academicRules` treats them as separate inputs (academicRules.ts:31,36); backend services.py:50-68 also treat them as separate inputs to the single-module union. **Duplicate responsibilities exist on both sides and no conversion path** (nothing creates one from the other; seed data has `ts-1` combined sessions with no timetable counterpart and timetable rows with no teaching session). An integration layer must choose a canonical attendance source (backend canonicalizes via `teaching_session`; the frontend references both). **Not resolved here (per audit scope).**

---

## 15. Import Pipeline Status — **STILL FAKE (P0, historical finding confirmed)**

Every claim from the Phase 1 finding re-verified **still true**:
- `analyzeFile` **ignores `fileData.textContent`** and returns hardcoded headers/rows/totals (timetableApi.ts:173-291).
- `discoverRelationships` falls back to `existingSections.slice(0,3)` when combined groups don't resolve (timetableApi.ts:441).
- `validateRows` falls back to `existingSections[0]?.id || 'sec-1a'` (timetableApi.ts:567-572) — silent wrong-section mapping.
- `confirmImport` creates teachers/subjects in localStorage but s**only writes timetable slots + an import job** — no `TeacherAssignment`, no `TeachingSession` (timetableApi.ts:727-837).
- Imported slots never reach teacher "My Classes" (that view reads teaching sessions/assignments, teacherService.ts:58-75).
- **Nothing in the pipeline touches PostgreSQL**; the wizard's PostgreSQL copy is marketing (TimetableImportWizard.tsx:237,433,629,…).

---

## 16. Calendar / Holiday Status

Backend: `Holiday` model + `/api/academics/holidays/` CRUD exist. Frontend: `CalendarHolidaysView` → localStorage. Users **never** call the holiday API. Behavioral gaps: holiday only blocks attendance-submit for the session date in TakeAttendanceView (interval timed against a **hardcoded date**, §19); there is no timetable/teaching-session suppression, no "multiple declarations per day" validation, and no Saturday-system-holiday concept in the backend model. The Phase 1 "halt roll call / dashboard warnings" copy exceeds actual behavior (only a submit-block + one notification).

---

## 17. Promotion Status

Frontend: `promotionService.promoteStudents` mutates student `semesterId/sectionId` in localStorage, writes a `PromotionRecord` + notification; eligibility uses `getStudentAttendanceSummary` which **defaults to 92%** on empty data (storage.ts:379). No attendance archival ("archived" is copy only). **Backend: no promotion model/endpoint/enrollment-history exists** (grep `promot|enrollment` over `backend/` → 0). "Zero Data Loss" promotion claims are unsupported; deletion/rollback semantics are client-only.

---

## 18. Reports Status

Sources: **localStorage only.** `reportService.generateReport` computes from `store.getAttendanceSessions()` with **hardcoded `: 88` fallback** when a subject has no sessions (ReportsView.tsx:95) and 92%/90% defaults (storage.ts:379,416). CSV export is a client Blob download; "dispatch defaulter notice" is a toast only (ReportsView.tsx:132-138).

On correctness vs a missing-record-as-Present heuristic: **neither side treats unmarked students as Present.** Backend counts only `marking_complete=True` records (reports/views.py:28-43,83-99); frontend excludes unmarked from its `records`, but both **exclude unmarked students from the denominator**, which **inflates** percentages (present/only-marked). Because the frontend **QR** path emits `absent` rows for everyone by default (§11), QR-originated sessions will further skew the ratios. Backend `by_subject` **captures but ignores the `semester` filter** (reports/views.py:53 — verified), and `summary.totalStudents` counts all students system-wide (views.py:32).

---

## 19. Dashboard Audit

| Statistic | Classification | Evidence |
|---|---|---|
| "Today" | **HARDCODED** `2026-09-06` | AdminDashboard.tsx:68, TeacherDashboard.tsx:62 |
| Admin avg attendance | LOCALSTORAGE, **fallback 88** | AdminDashboard.tsx:97 |
| Teacher avg rate | **HARDCODED 89** (state default + fallback) | TeacherDashboard.tsx:37,88 |
| Student summary % | LOCALSTORAGE, **fallback 92/90** | StudentDashboard.tsx:33; storage.ts:379,416 |
| Student badge "100% Active", faculty "4 Assigned", "Sem 1 in progress", "Sec A & Sec B", "Above 75%", "1 student requires intervention", course 89/87/92%, "6 Sessions" | **HARDCODED** | AdminDashboard.tsx:174,182,190,198,305,307,320,327,334,351; TeacherDashboard.tsx:149-173 |
| Totals (students/teachers/semesters…today's classes) | LOCALSTORAGE-derived | AdminDashboard.tsx:121-127, TeacherDashboard.tsx:90-96 |

No dashboard reads any API. No aggregate endpoint exists on the backend; "today's classes" filters a stale localStorage timetable by the hardcoded day (TeacherDashboard.tsx:65-76).

---

## 20. Storage / Export / Reset

**localStorage keys (prefix `aams_data_v1_`; full list verified):** users, semesters, sections, subjects, teachers, assignments, students, timetable, teaching_sessions, holidays, attendance_sessions, notifications, promotions, timetable_import_history · plus `aams_current_user`, `aams_auth_token`, `aams_active_qr_sessions_v1`.

- **Export (`exportStateJSON`, storage.ts:471-487)** includes 12 collections but **EXCLUDES `teaching_sessions`, `timetable_import_history`, and QR sessions.** `importStateJSON` (storage.ts:489-517) restores symmetrically → those collections are silently dropped on backup→restore. **Historical concern remains true.**
- **Reset (`storage.ts:519-539`):** `localStorage.clear()` wipes ALL keys (incl. auth tokens + QR sessions), then reseeds in-memory. Since `this.teachingSessions`/`this.importHistory` are initialized only at class construction, after `localStorage.clear()` the **in-memory arrays keep stale copies** while fresh tabs re-seed empty storage → **tab-divergence latent bug.**
- **ExportTimetableModal** (ExportTimetableModal.tsx:26-44): "XLSX" and "CSV" options both produce CSV via `timetableApi.exportTimetableCSV`.

---

## 21. Security Findings (all verified against source)

### Authentication / Tokens
- **SEC-01 (P0)** — UI login never calls the backend; password ignored; fabricated `mock-jwt-token-*` (authService.ts:25,30-45,40,53). Backend `TokenAuthentication` would 401 any such header. Combined with the auto-admin default (authService.ts:21-27) and an unrestricted role switcher (Header.tsx:151-173), the frontend "session" is completely client-side and spoofable.
- **SEC-02 (P1)** — Token in plaintext localStorage (authService.ts:5, apiClient.ts:11); no expiry; `apiClient` throws on 401 but never redirects/clears/re-auths (apiClient.ts:73-106); `apiClient.logout` only clears locally and never calls `POST /api/auth/logout/` (apiClient.ts:126-128) so the server token is never revoked.

### Authorization / IDOR
- **SEC-03 (P0)** — `AttendanceSessionViewSet.mark`/`submit`/`perform_create` (attendance/views.py:53-90) have **no teacher-ownership check**: any teacher can create/mark/submit on any session, and `mark` accepts any `studentId` with **no check the student belongs to the session's sections**. Verified in source.
- **SEC-04 (P0)** — `QRAttendanceSessionViewSet` (attendance/views.py:105-162) has **no permission_classes** → global `IsAuthenticated` default. Any authenticated user (students included) can call `mark`/`validate`/`stop`. `mark` validates only the live code + arbitrary `studentId` (views.py:140-156, services.py:70-85) — no section check, no per-user one-time binding. `start` only checks the session exists and isn't finalized — no check the session belongs to the requesting teacher.
- **SEC-05 (P1)** — `AttendanceRecordViewSet` (attendance/views.py:93-102) unrestricted by role: any authenticated user (incl. students) can list/create/update/delete attendance records.
- **SEC-06 (P1)** — `teachers`/`students` use `AdminOrReadOnly` (teachers/views.py:11, students/views.py:11) → any authenticated user (students) can read all teachers'/students' PII (name/email/phone/guardian/address).
- **SEC-07 (P2)** — Reports open to students and lack ownership scoping; `by_subject` ignores its own `semester` param (reports/views.py:53); `summary.totalStudents` is institution-wide (views.py:32). Notifications are correctly recipient-scoped (notifications/views.py:12-15).

### QR
- **SEC-08 (P1)** — Live token is returned by `GET /api/attendance/qr/<id>/` (serializer includes `token` + computed `payload`, attendance/serializers.py:88-99) and the QR queryset is effectively IsAuthenticated-open for students; combined with SEC-04 a student can read the live token (no scanning) and mark arbitrary students — replay is bounded only by the 15s rotation, and there is **no per-code consumption tracking** (services.py:41-67).

### Combined-section authorization
- **SEC-09 (P1)** — No server check that a session's `sections`/`subject` belong to the starting teacher, and `mark_qr_student` performs **no section filter** (services.py:70-85; only `roll_call_for_session` scopes to `session.sections`, services.py:119).

### Config / Secrets
- **SEC-10 (P1)** — Real DB password in `.env` (plaintext on disk; no `.git`, so not committed, and `.gitignore` excludes `.env*` — but the file lives in a synced OneDrive workspace). `SECRET_KEY` has an insecure hardcoded default (base.py:21-24) with no production override enforcement. `.env.example` is a stale Gemini template with Django vars commented out.
- **SEC-11 (P3)** — CORS is explicit (not AllowAll), credentials allowed (base.py:156-164); `ALLOWED_HOSTS` default includes `0.0.0.0` (base.py:29). Standard DRF posture; low risk.

---

## 22. Data Model Consistency

**Global:** frontend uses string IDs (`sem-1`, `tch-1`, `sec-1a`, `sub-101`, `tt-*`, `stu-*`…) on every entity; backend uses integer PKs everywhere, with `Teacher.teacher_id`/`Student.student_id` as the only stable natural keys. `'tch-1'` (frontend id) ≠ `'TCH-001'` (teacher_id), so an integration layer must maintain an id-lookup/映射 table.

**Entity-level highlights (full mapping derived in the workstream; key mismatches):**
- **User/Me:** role values identical; `me` returns derived `teacher_id/student_id/semester_id/section_id` (accounts/serializers.py:29-41) but frontend `User.semesterId/sectionId` (types/index.ts:9-14) has **no backend column** (derived only).
- **Naming:** camelCase→snake everywhere (academicYear→academic_year, rollNo→roll_no, startDate→start_date, classType→class_type, isCombined→is_combined, sectionIds→section_ids/`sections` M2M, session date→session_date, endTime→planned_end_time…). FK fields `semesterId`→integer FK id.
- **AttendanceSession:** frontend has `semesterId`, `room`, `notes`, `timetableSlotId`, and a per-student `records` **map**; backend has none of those, and stores records as **child rows** (`AttendanceRecord`, unique(session,student)). Backend also has **two end-time fields** (`planned_end_time` + nullable `end_time`), `phase`, `attendance_ids`/`marked_ids` JSON, `late_reason`, `created_by`.
- **QRAttendanceSession:** frontend `sectionIds` **≠** backend `student_ids` (backend's JSON is scanned **student** ids, models ~153); frontend 3-state `status` (active/completed/cancelled) vs backend `revoked` bool + session `is_finalized`; expiry stored as epoch-ms vs backend `token_generated_at` + TTL constant.
- **Enums:** Role, Semester/Section/Subject/Teacher/Student/Assignment statuses, DayOfWeek (Sunday–Friday, both sides), HolidayType, AttendanceStatus all match **by value**. `AttendancePhase` and `AttendanceSession.status`/QR status are backend-only or derived (no enum). `NotificationType` is **constrained** on the frontend (5 values) but a **free string** on the backend — mismatch. `TimetableImportJob`/`PromotionRecord` (and `AllocationRowStatus`) are frontend-only — **no backend tables**.
- **Nullability:** frontend `Student.admissionYear` required vs backend `admission_year` blank/nullable; `Student.semester/section` backend nullable (SET_NULL) vs frontend required.

---

## 23. Phase 1 Regression Status — **INTACT**

All verification re-run this audit (read-only): 
- `npm run lint` (`tsc --noEmit`) → **PASS**, clean.
- `npm run build` → **PASS**, 1801 modules, only a chunk-size warning (817 kB, non-blocking).
- `py manage.py check` → 0 issues.
- `py manage.py showmigrations --plan` → 27/27 applied, none pending.
- `py manage.py test` → **21 passed, 0 failed** (26s), covering accounts auth, academics rules (single-module, semester consistency, timetable conflicts), attendance (UNMARKED never-auto-Present, one-record-per-student, QR lifecycle/replay/finalize-block).
- Read-only DB snapshot confirms demo data (semester, 2 sections, 5 subjects, 3 teachers, 5 students, demo users admin@aams.local + r.prof@aams.local; attendance session/record/QR rows consistent with the earlier QR smoke run).
- QR scanner route, NotFoundView, UnauthorizedAccessView, role guards, combined-section seed relationships — unchanged and compiling.

No regression introduced by the backend foundation work.

---

## 24. Complete Finding Register (P0–P3)

### P0 — critical
| ID | Category | Location | Current behavior → Expected | Evidence | Recommendation | Blocks deploy? |
|---|---|---|---|---|---|---|
| AUD-P0-01 | Integration | all frontend `src/services` + `features` | Entire UI runs on localStorage/initialData; **zero** HTTP calls; `apiClient` orphaned → UI must call Django | grep: only definition in apiClient.ts:108; all services use `store` | Wire an API layer behind every service (phased per roadmap) | **Yes** (product is a demo) |
| AUD-P0-02 | Auth mismatch | authService.ts:25,30-45,40,53 | Login never calls `/api/auth/login/`, password ignored, fabricated token → real login + DRF token, secure storage | verified above | Connect AuthContext→apiClient.login; use returned Token; sign in via backend; add 401 handling | **Yes** |
| AUD-P0-03 | IDOR | attendance/views.py:53-90 | Any teacher can create/mark/submit any session and mark any student (no ownership/section check) → enforce session.teacher==requester, student∈session.sections | verified above | Object-level ownership + roster check on mark/submit | **Yes** (before UI exposes it) |
| AUD-P0-04 | QR authz | attendance/views.py:105-162; services.py:70-85,41-67 | QR viewset IsAuthenticated-only; mark accepts arbitrary studentId; live token readable via GET qr/{id} (incl. students) → restrict QR actions (teacher start/stop; student-scoped check-in with one-time binding) | verified above | IsTeacherUser on start/stop; student-scoped, per-student one-time code; never return live token to students | **Yes** |
| AUD-P0-05 | Fake core workflow | timetableApi.ts:173-291,441,567-572,727-837 | Import := hardcoded analyze + fallback `sec-1a` mapping; no assignments/teaching sessions; never reaches My Classes or PostgreSQL → real parser + transactional import that creates assignments/teaching sessions | verified above | Rebuild pipeline; create `TeacherAssignment`/`TeachingSession`; drop fabricated totals | **Yes** (feature is a lie today) |

### P1 — high
| ID | Category | Location | Current → Expected | Evidence |
|---|---|---|---|---|
| AUD-P1-01 | AuthZ | attendance/views.py:93-102 | Unrestricted record CRUD for any authenticated user (students) → restrict to teacher/admin + scope | verified |
| AUD-P1-02 | Token/401 | apiClient.ts:73-106,126-128; authService.ts:60-65 | No 401 handling; logout never revokes server token → handle 401 globally, call `/api/auth/logout/` | verified |
| AUD-P1-03 | PII | teachers/views.py:11; students/views.py:11 | Any role reads all students'/teachers' PII → role-aware read scoping | verified |
| AUD-P1-04 | QR start authz | attendance/views.py:119-130 | QR can attach to any non-finalized session (no teacher/section match) → validate session.teacher & assignment | verified |
| AUD-P1-05 | Reports | reports/views.py:53,32; views.py:17-18,50-51 | `by_subject` ignores `semester`; `summary.totalStudents` global; students can call reports → honor filters; role/scope-aware | verified |
| AUD-P1-06 | Attendance semantics | qrAttendanceService.ts:66,247-265 | Frontend QR defaults everyone to `absent` and persists it → violates documented UNMARKED semantics (backend keeps no row) | verified |
| AUD-P1-07 | Data integrity | storage.ts:379,416; ReportsView.tsx:95; dashboards 88/89 | Fabricated/fallback attendance percentages (92/90/88/89) present as real data → remove fallbacks; compute from records | verified |
| AUD-P1-08 | Promotion | promotionService.ts; None in backend | No backend promotion/enrollment-history; "archival"/"zero data loss" claims false → new promotion service + history; snapshot attendance | verified (backend grep=0) |
| AUD-P1-09 | Secrets | .env:4; base.py:21-24 | Real DB password on disk (synced workspace); insecure default SECRET_KEY → rotate creds; enforce env-supplied SECRET_KEY; fix .env.example | verified |
| AUD-P1-10 | Backup/restore | storage.ts:471-517 | Export/import omit teaching_sessions, import_history, QR → include all collections; document | verified |
| AUD-P1-11 | Notifications | NotificationsView.tsx:70-98; notificationService.ts:26-45 | Broadcast `target` collected but never sent; per-role targeting fake → send target; backend makes per-recipient rows | verified |

### P2 — medium
| ID | Category | Location | Finding |
|---|---|---|---|
| AUD-P2-01 | Dashboard honesty | AdminDashboard.tsx:174,182,190,198,305,307,320,334,351; TeacherDashboard.tsx:37,88,149-173; StudentDashboard.tsx:33 | Hardcoded stats/badges/ratios presented as real; today = `2026-09-06` constant not `new Date()` |
| AUD-P2-02 | Reset | storage.ts:519-539 | `localStorage.clear()` leaves stale in-memory teachingSessions/importHistory → cross-tab divergence |
| AUD-P2-03 | Export | ExportTimetableModal.tsx:26-44 | "XLSX" option writes CSV; no true XLSX |
| AUD-P2-04 | Profile | UserProfileView.tsx:22-23 | Profile resolves by mismatched id → shows wrong teacher/student (fallback `[0]`) |
| AUD-P2-05 | Settings | SettingsView.tsx:25-47,36-47 | Policy form is mock (`setTimeout` toast); fields consumed by nothing; no backend endpoint |
| AUD-P2-06 | Data model | QR `sectionIds` vs `student_ids`; `records` map vs rows; backend-only fields (phase/attendance_ids/marked_ids/created_by) | Integration mapping layer must translate; no code exists |
| AUD-P2-07 | NotificationType | notifications/models.py | Backend free-string vs frontend 5-value enum (accepts garbage) |
| AUD-P2-08 | Pagination | base.py:150-151 | PAGE_SIZE=100 silently truncates big rosters/reports for a connected UI |
| AUD-P2-09 | N+1 | attendance/views.py:32 | No `prefetch_related("sections","attendance_records")` — serialization cost on combined sections |

### P3 — low
| ID | Category | Location | Finding |
|---|---|---|---|
| AUD-P3-01 | Tooling | root | 817 kB chunk warning; no code-splitting |
| AUD-P3-02 | Docs | .env.example | Stale Gemini/AI-Studio template; Django vars commented out; `VITE_API_BASE_URL` present |
| AUD-P3-03 | Duplicate rules | academicRules.ts vs academics/services.py | Same business rules duplicated FE/BE (intentional parity, but adds drift risk — both currently consistent) |
| AUD-P3-04 | Testing | backend apps | teachers/students/notifications/reports have no tests |
| AUD-P3-05 | UX copy | TimetableImportWizard.tsx:237,433,629…; PromotionView.tsx:117 | "PostgreSQL"/"archived" copy overstates actual behavior |

**Counts:** P0 = 5 · P1 = 11 · P2 = 9 · P3 = 5.

---

## 25. Dependency-Aware Implementation Roadmap (not implemented)

Order chosen by dependency (each step enables the next):

1. **Security hardening of the existing API surface (P0-03, P0-04, P1-01…05, SEC corrections)** — *prerequisite*: the current API must be safe before a connected UI can rely on it. Adds ownership checks, student scope, QR one-time binding, report scoping.
2. **Auth foundation alignment (P0-02)** — wire `AuthContext`/`LoginView` to `apiClient.login`, store real DRF token, global 401 handling, server logout. Unlocks every other API call.
3. **ID/name-mapping layer (P2-06)** — shared TypeScript adapter mapping string ids→PKs and camelCase→snake_case; the backbone for all remaining wiring.
4. **Core admin CRUD** (semesters/sections/subjects/teachers/students/assignments/holidays) — mechanical once 1–3 exist.
5. **Timetable + TeachingSession consolidation** (canonical source of truth for My Classes).
6. **Attendance integration** (manual sessions: create/roster/mark/roll/submit).
7. **QR integration** (start/validate/mark/stop against hardened endpoints; enforce UNMARKED semantics parity — fix AUD-P1-06).
8. **Reports** wiring + report scope filters; remove fabricated fallbacks (AUD-P1-07).
9. **Dashboards** — add aggregate endpoint, make dates dynamic.
10. **Notifications / profile / settings** — real recipient targeting; backend settings endpoint.
11. **Promotion backend** (new model + transaction + history) — needs marking/attendance semantics first.
12. **Import pipeline rebuild + persistence** (real parser; teaches My Classes).
13. **Backup/export/reset** completion (include all collections; XLSX; reset fix).
14. **BSSID/network verification readiness** — *after* 6/7/1 (needs session anchoring + per-student verification).
15. **Regression + security tests** throughout; promotion/import/teachers/students/reports test coverage.

This ordering front-loads security and auth (blockers for anything else being real), then proceeds core→workflow→niche, matching the actual coupling found in the audit.

---

## 26. Remaining Work Estimate (evidence-based)

- **Major workstreams remaining: 15** (roadmap above; collapse to ~12 if backup/settings/export merge into their parents).
- **Findings:** 5 P0 · 11 P1 · 9 P2 · 5 P3.
- **Rough engineering effort:** Single engineer ≈ **300–380 hours** (~8–9.5 person-weeks). Basis: ~20 services to wire, an id/field mapping layer, 11 P1 authz/correctness items, 2 net-new backend features (promotion, import persistence) plus a settings endpoint and aggregate endpoints, plus security/regression tests; the existing backend already covers most CRUD + QR protocol, so this is integration + hardening work, not greenfield.
- **Parallelizable:** core CRUD wiring (workstream 4) across independent features; unit tests; dashboard/report polish (once reports endpoint filters fixed); export/reset fixes.
- **Must remain sequential:** security hardening → auth → mapping layer → attendance/QR (everything downstream depends on them); promotion and import depend on attendance/teaching-session semantics; BSSID depends on QR.
- **Major blockers:** P0-03/P0-04/QR authorization (blocks any safe connection) and P0-02 (blocks every authenticated call). P0-01 is the overarching integration gap. P1-06 UNMARKED divergence must be resolved before attendance data lands in PostgreSQL.

---

## 27. Frontend/PostgreSQL Coverage Estimate

**Estimated Django/PostgreSQL-backed functionality: 0%** (methodology below).

Methodology: enumerate the 21 top-level services + 10 primary user workflows (login, admin CRUD ×6, timetable, manual attendance, QR, import, holidays, promotion, reports, notifications, dashboards, profile/settings, export/reset), classify each by the Service→API matrix (§6) with core workflows weighted ×3 over cosmetic pages, and count how many complete their data path against Django. Result: **0 of 10 workflows, 0 of 20 services** reach the backend (`apiClient` unused, only `fetch()` in the codebase never invoked). To avoid a false 0% impression, note the **protocol/parity layer** that *is* already aligned and cost-free to keep: QR payload/token format (byte-identical), UNMARKED manual semantics, business-rule duplication (single-module, conflicts), enum values, and all 7 backend apps/27 migrations/21 tests working.

Per-area coverage: **core workflows 0% · admin 0% · teacher 0% · student 0% · attendance 0% · reporting 0%.** (Backend capabilities themselves are ~90% present for attendance/auth/academics; the *frontend connection* is 0%.)

---

## 28. Deployment Blockers

1. **AUD-P0-01** — the UI does not talk to the backend at all; deploying as-is ships a localStorage demo.
2. **AUD-P0-02** — no real authentication; fabricated tokens.
3. **AUD-P0-03 / AUD-P0-04 / SEC-08** — attendance/QR authorization holes (IDOR, self-marking, token exposure) would be exploitable the moment the UI is connected.
4. **AUD-P0-05** — import feature presented as real while it fabricates data.
5. **SEC-10** — real DB password on disk; no `.env`→production secrets separation.
6. **AUD-P1-06/07** — frontend QR emits `absent` for unmarked students and fabricated fallback percentages → corrupt attendance data on first connected sync.

Deployment for the current localStorage demo itself is possible (it's a static Vite build), but **not as a backend-connected product.**

---

## 29. Final Recommendation

Do **not** begin the general integration yet. Recommended order:

1. **Harden the API first** (P0-03, P0-04, P1-01…05): teacher-ownership + roster checks, student-scoped QR check-in with one-time binding, restrict `AttendanceRecord`/QR viewsets, fix `by_subject` filter, scope reports. Add tests for each. *This is the cheapest moment to do it (no consumers yet).*
2. **Front-load auth wiring** (P0-02) and the id/field mapping layer (P2-06), so every later step is real.
3. **Integrate in phases** (roadmap §25), keeping the localStorage services as a fallback behind the mapping layer, and add a visible "source is localStorage vs API" indicator for honest QA.
4. **Fix the QR-absent default (P1-06)** and **remove fabricated percentage fallbacks (P1-07)** in the same changeset as attendance/QR integration.
5. **Rotate the leaked DB password and enforce env-based SECRET_KEY (SEC-10)** before any connected deployment.
6. **Re-audit after Phase 2** with a connected smoke test (login → admin CRUD → attendance → QR → report) against PostgreSQL.

Expected: after the above, the only remaining workstreams are promotion, import persistence, dashboard aggregates, backup/export completion, and BSSID network anchoring — none of which block going live with the core flows.

---

*Audit constraints honored: zero application/source/model/migration/API/database changes; all findings verified against actual repository source; verification commands re-run read-only.*