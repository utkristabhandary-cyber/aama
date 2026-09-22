# PHASE J REPORT — Frontend Visual Redesign (Institutional Red)

Status: **COMPLETE** — 22 September 2026

Scope: redesign the AAMS web frontend into a clean, minimal, professional
institutional UI under a single restrained accent ("Institutional Red"), without
changing any backend rule, API contract, auth/authorization boundary, attendance
security, import/export pipeline, timetable rule, or the Timesheet state machine.
No fake data or mocks were introduced or removed; every visible record is live
server data.

---

## Deliverable Checklist (12/12 DONE)

### Design system

1. **DONE** — **Token-level retheme** in `src/index.css`. The one-slot primary
   ramp (`indigo`) is redefined to an institutional red ramp via a Tailwind v4
   `@theme` block, so every existing utility re-accentuates without rewriting
   ~72 page files. The decorative `purple` ramp is neutralized to slate. Kept
   as-is: `slate` (neutrals), `blue` (sparse info), `emerald`/`amber`/`rose`
   (status). In use: `bg-indigo-600` now renders `#d21f2e`.
2. **DONE** — **Typography tokens**: `--font-sans` (Plus Jakarta Sans stack) and
   `--font-mono` declared in `@theme`; `code`/`pre` default to the mono stack.
3. **DONE** — **Accessibility baseline**: global `:focus-visible` rule (2px
   red outline + 2px offset) and `::selection` tint added in `@layer base`.
   Verified focus-visible / focus-within behavior in the browser walkthrough.

### Application chrome

4. **DONE** — **Sidebar**: refined footer that stops stating a hard-coded
   "2026-2027" academic year and a non-factual "Enterprise Edition v2.4"
   marketing line; replaced with an honest "AAMS v2 · Web-only institutional
   edition". Brand mark, active row, role chip, and shadows now resolve to the
   red ramp automatically.
5. **DONE** — **Header**: breadcrumb map completed for unmapped views
   (`timesheet`, `qr-scanner`, `my-history`, `section-allocation`) and made
   role-aware for the shared timesheet view ("My Timesheet" for teachers,
   "Teacher Timesheet" for admins).
6. **DONE** — **LoginView**: moved from a dark navy screen with a dot pattern
   and multi-color demo tiles to a light, minimal, neutral login card with the
   red brand mark; the demo access block is demoted to a muted, clearly-labeled
   "Developer demo sign-in (seed accounts)" convenience. Login flow unchanged.
7. **DONE** — **App loading screen**: flattened dark background to the shared
   light neutral surface so the skeleton matches the rest of the app.

### Components

8. **DONE** — **Modal**: added keyboard focus management — focus moves into the
   opened dialog, Tab/Shift+Tab cycle is trapped, Escape closes, and focus is
   restored to the trigger on close. Verified in-browser (open → trap → Escape
   → focus returned to "Log Hours").
9. **DONE** — **Gradient removal**: the four decorative gradients banned by the
   design brief were flattened (Student dashboard hero → flat `slate-900`,
   Teacher dashboard hero → flat `emerald-900`, Student profile cover → flat
   red, Student attendance note card → flat light-red tint).

### Truthfulness & polish

10. **DONE** — **Stale copy cleanup**: Admin dashboard "Semester 1 cohorts"
    (live data is SEM-S4) → "from live session records"; the accurate
    GlobalSearchModal "never falls back to local demo records" comment and the
    honest LiveQR "without network attestation" note are confirmed correct and
    left intact.
11. **DONE** — **Session reset on identity change**: `App` now resets the
    active view (and selected timetable slot) to the user's dashboard when the
    signed-in identity changes (login/logout/role switch), so a new session no
    longer inherits the previous account's navigation state. The role route-
    guard (`VIEW_ROLE_PERMISSIONS`) is unchanged and still authoritative.
12. **DONE** — **Responsive + role walkthrough** (see Verification).

---

## Verification

### Automated gates (all green)

| Gate | Result |
| --- | --- |
| `tsc --noEmit` (`npm run lint`) | clean |
| Vitest full suite | 12 files / 115 / 115 passed |
| `npm run build` | built in 6.64s (CSS 68.7 kB incl. token block; pre-existing chunk advisory unchanged) |
| `py manage.py makemigrations --check --dry-run` | "No changes detected" |
| `py manage.py test` | Ran 439 tests in 595.8s — OK (test DB destroyed) |

### Browser walkthrough (chrome-devtools against Vite dev on `:3000`, Django on `:8000`)

- **Palette live**: computed brand mark, active nav row, and primary buttons all
  `rgb(210,31,46)`; body `#f8fafc`; font stack applied; flat heroes confirmed
  (`background-image: none`).
- **Admin**: Dashboard, Timetable, Teacher Timesheet, Students (table scroll
  contained) all render live data with the red accent; stale dashboard copy
  replaced.
- **Teacher** (tch-3 / Dr. R. Kumar): dashboard, My Timesheet, Take Attendance
  manual roll call (4-student roster) and Live QR pane (real rotating token,
  honest "without network attestation" note); camera flow untouched.
- **Student** (std-1 / Ananya Verma): dashboard dossier, QR scanner idle state
  (truthful "Camera Viewfinder Idle" + manual entry), role route-guard confirms
  boundary ("ACCESS BOUNDARY ENFORCED").
- **Modal focus trap**: verified open → focus-in, Tab wrap, Escape close,
  focus restore.
- **View reset**: after logout/login as a different role the app now opens on
  Dashboard rather than the previous role's view.
- **Responsive**: no page-level horizontal overflow at 1440 / 1280 / 1024
  (sidebar persistent) / 768 / 390 (sidebar off-canvas, hamburger opens it with
  backdrop, no overflow; table overflow contained in scroll containers).

---

## Files changed

- `src/index.css` — `@theme` token block (indigo→red, purple→slate), font
  tokens, focus-visible/selection/smoothed base layer.
- `src/App.tsx` — loading screen surface; identity-change view reset.
- `src/components/layout/Sidebar.tsx` — honest neutral footer.
- `src/components/layout/Header.tsx` — breadcrumb map completion + role-aware
  timesheet label.
- `src/components/ui/Modal.tsx` — focus trap / initial focus / focus restore.
- `src/features/auth/LoginView.tsx` — light minimal redesign + demoted demo
  block (copy that now reads "Developer demo sign-in / Seed accounts").
- `src/features/dashboard/AdminDashboard.tsx` — outdated "Semester 1 cohorts"
  description → live-session phrasing.
- `src/features/student/StudentDashboard.tsx`,
  `src/features/student/StudentAttendanceView.tsx`,
  `src/features/student/StudentProfileView.tsx`,
  `src/features/teacher/TeacherDashboard.tsx` — decorative gradients flattened.

## Out of scope (unchanged by design)

- Backend models, serializers, endpoints, migrations, seed data — untouched
  (`makemigrations --check` clean; 439 backend tests pass).
- Authentication/authorization, route-guard matrix, QR token/import/export
  pipelines, Timesheet and Timetable business rules — untouched (only frontend
  presentation and honest copy).
- Student QR camera logic and the classroom LiveQR display engine — untouched;
  only their visual surfaces inherit the retheme.
- `dist/` (gitignored) — build artifacts not committed.