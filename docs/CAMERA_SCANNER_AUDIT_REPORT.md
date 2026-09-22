# AAMS v2 — Camera Scanner Audit & Fix Report

**Scope:** Student QR camera scanner only. No changes to attendance/QR security, no changes to
other views, no changes to the (separately delivered, complete) Timesheet feature.
**Status:** COMPLETE — fixed, unit-tested, mocked-browser verified. Physical-camera verification
remains a pending manual step (item 5).

---

## 1. System / Feature Under Audit

- Feature: **Student QR Attendance camera scanner** — `StudentQRScannerView`
  (`src/features/student/StudentQRScannerView.tsx`).
- Route: `'qr-scanner': ['student']` (`src/App.tsx`), reachable from the student portal sidebar
  ("QR Attendance") and the dashboard "Scan Attendance QR" action.
- Purpose: the student activates their web camera, points it at the teacher's classroom display,
  the viewfinder decodes the rolling QR payload (`AAMSQR1|<session id>|<TOKEN>`), and the student is
  checked in via the server-authoritative endpoint `POST /api/attendance/qr/check-in/`.
- Surrounding code paths that were deliberately **not** modified: the rolling-token security model
  (15s TTL, constant-time comparison, one active session per teacher, idempotent check-in, replay/
  duplicate/rotation protection, rate limiting), the manual token entry fallback, and the teacher-side
  `LiveQRPane`.

## 2. Reported Symptom

- The viewfinder was permanently stuck at **"Camera Viewfinder Idle"** with the **"Activate Device
  Camera"** button always visible. Clicking the button never produced a live preview; the UI never
  transitioned to any other state.
- Field pattern: the camera **LED** could switch on (geolocation/camera permission granted) while the
  UI showed nothing — i.e. the stream was being acquired and then orphaned.

## 3. Reproduction

- Frontend-only path. Steps: log in as a student → QR Attendance → click **Activate Device Camera**
  → grant the permission prompt → observe that the viewfinder never leaves the idle overlay and no
  `<video>` frame appears. Refresh → identical behavior.
- In a hardware-less environment this reproduces deterministically once you assert the invariant in
  item 4 below (see item 21 for how the viewfinder is exercised without hardware).

## 4. What "Working" Means (acceptance criteria for this fix)

1. Clicking **Activate Device Camera** runs the camera pipeline and the viewfinder reaches a live
   state **if and only if** a MediaStream is actually delivered and attachable.
2. A live state renders a real `<video>` element carrying the granted `MediaStream` (through
   `srcObject`, playing), with a "LIVE PREVIEW" indicator.
3. **Stop Camera** stops every track of the granted stream and returns the viewfinder to idle.
4. Leaving the page (unmount) also stops the stream — no orphaned camera.
5. Each failure mode gets an **honest, distinct, user-actionable message** (permission denied,
   no device, busy, insecure context) with a **Retry** path.
6. Starting the camera during an already-pending request is a no-op (no double acquisition).
7. No changes to the check-in security model; manual entry unchanged.

Gates used to judge "done": TypeScript (`tsc --noEmit`) clean, frontend unit suite green, frontend
production build green, backend suite + migration check green, mapped automated checks in `docs/
21-TESTING.md` satisfied. All passed (item 13).

## 5. Hardware-Verification Limitation (HONEST)

- **This environment has no physical camera.** Automated verification used a **mocked
  `getUserMedia`** both at the unit level (jsdom) and in a real browser session (a genuine
  `MediaStream` produced by `canvas.captureStream()` injected before activation — see items 13 and 21).
- What that verification proves: that when a valid stream resolves and is settable on the video
  element, the full lifecycle (attach / play / live UI / stop / cleanup / error mapping) works.
- What it does **not** prove: the behavior of an actual device driver, real permission prompts on a
  mobile browser, the physical `facingMode: environment` preference, or real-world camera-device
  strings. **Physical-camera verification on a real classroom device remains a pending manual,
  deployment-time step** and is NOT claimed as passed. See `09-QR-ATTENDANCE.md` for the deployment
  requirement (HTTPS or `localhost`).

## 6. Root Cause (confirmed)

A rendering circularity in the original component:

- The `<video>` element was conditionally rendered **only when `cameraActive === true`**.
- `cameraActive` was set to `true` **only inside** `if (videoRef.current)` — i.e. only after
  `await getUserMedia()` had already resolved — inside the click handler.
- At click time the element did not exist, so `videoRef.current` was `null`, the `if` never ran, the
  stream was never attached, and `cameraActive` was never set. The viewfinder stayed idle forever,
  and the granted `MediaStream` (and its track(s)) was **orphaned** — never stopped, with no UI to
  stop it.

Contributing defects present at the same time (fixed with the root cause):

- `facingMode: 'environment'` was a **hard** constraint; devices exposing no rear camera threw
  `OverconstrainedError` even though a usable front camera existed.
- The `video.play()` promise was not awaited/handled; an autoplay rejection produced a silent dead
  view.
- Only one placeholder error message existed for all failure classes; no distinct guidance for
  permission denial, no-device, or busy.
- No `initializing` state, no Stop/Restart control, no double-activation guard, and no unmount-time
  stream cleanup.

## 7. Diagnostic Method (isolation, real vs phantom defect)

- Confirmed `StudentQRScannerView.tsx` is the **only** camera consumer in the codebase (grep over
  `getUserMedia` / `srcObject` / `userMedia`); no other page or component shares or depends on the
  scanner (item 22).
- Confirmed the defect is **frontend-only**: the backend check-in chain is unchanged and fully green
  (backend suite 439/439, migrations clean), and the manual-entry token fallback on the same page
  already worked.
- Re-read the component; derived the circularity (item 6); then validated the hypothesis by rewriting
  the lifecycle per item 8 and letting both the regression suite (item 21) and the mocked browser run
  (items 13, 21) confirm the exact chain it used to miss.

## 8. The Fix (as implemented)

The component now runs a **four-state machine**

```
idle → initializing → active
        │
        └──→ error
```

- The `<video>` element is mounted whenever `cameraState !== 'idle'`, so the element (and its ref)
  exists by the time `getUserMedia` resolves and the stream can be attached — the circularity is
  broken.
- Camera acquisition now: guard `startingRef`/state → set `initializing` → require a secure context
  → require `navigator.mediaDevices` → request with `facingMode: { ideal: 'environment' }` →
  attach resolved stream to `video.srcObject` → `await video.play()` → `active`.
- `facingMode` is declarative-`ideal` (aspirational preference), never a hard constraint, so a
  laptop/front camera initializes cleanly while phones still prefer the rear camera.
- Error mapping (`cameraErrorMessage`) — the exact user-visible strings (item 19).
- Cleanup: `stopCamera()` (Stop button) and the unmount effect both call `releaseStream()`, which
  stops whatever is attached to the video **and** any stream still pending attachment
  (unmount-during-prompt), then nulls `srcObject`. A dedicated `attachedVideoRef` keeps the
  attachment reachable during unmount even though React detaches `videoRef`.
- The unmounted-during-pending path explicitly stops the late-resolving stream so a granted camera
  can never be orphaned.
- Manual token entry, payload parsing, and the decode loop (jsQR, `HAVE_ENOUGH_DATA`, non-zero
  `videoWidth/Height` guard, 7-second dedupe) are unchanged; the decode effect now runs **only while
  the state is `active`**.

## 9. Security Impact Analysis

- **Web security model of QR attendance — unchanged.** The check-in remains fully server-authoritative:
  the student's identity comes from `request.user` (`student_profile`), the QR payload only proves the
  student scanned the classroom screen, and `network_verification_method` remains `unavailable`
  (browsers cannot attest a BSSID). No client-claimed evidence is trusted.
- **No new attack surface introduced.** The scanner only consumes a `MediaStream` and renders it
  locally; it never transmits camera bytes to the backend. The stream is stopped on Stop/unmount.
- **Permissions are request-scoped** — on real browsers the camera grant persists until the stream is
  stopped, which the Stop/unmount cleanup now guarantees in all orientations.
- The 15s token rotation, constant-time compare, one-active-QR-per-teacher, duplicate/replay/rate-limit
  protections were untouched by this fix. No secrets logged.

## 10. Error Handling — complete failure inventory

| Browser error (`name`) | User-visible message (exact) |
| ---------------------- | ---------------------------- |
| `NotAllowedError` | "Camera permission was denied. Allow camera access in your browser settings, then press Retry." |
| `NotFoundError` | "No camera device was detected on this device. Check your camera and press Retry." |
| `NotReadableError` | "The camera is currently in use by another application. Close it and press Retry." |
| `OverconstrainedError` | "No camera matches the requested video mode. Try a different camera or device." |
| `SecurityError` / `InsecureContext` | "Camera access requires an HTTPS (or localhost) connection." |
| Missing `navigator.mediaDevices` / `getUserMedia` | "Your browser does not support camera access." |
| Anything else | the error's `message`, or "Camera access failed. Try again or enter the code manually below." |

Every error state shows a **Retry Camera** button that re-runs the acquisition pipeline.

## 11. Viewfinder Ownership & Permissions

- The scanner view is reached via the student portal (role `student`) only; the route is
  role-gated in `src/App.tsx`. No other role or page mounts it.
- The **camera permission prompt belongs to the browser**, on first activation, and only shows in a
  secure context. The application does not and cannot bypass, pre-acquire, or remember the grant; the
  code simply surfaces the browser's decision honestly. The whole Check-in flow reuses the **existing**
  backend auth token — no new credentials, cookies, or scopes.

## 12. Scope Creep Check

- Only `StudentQRScannerView.tsx` (behavior/fix) and its new test file were added/changed this item,
  plus the `jsdom` test dependency and the docs listed in item 24.
- **No** other page, component, route, color, layout, or nav was modified.
- **No** backend code or schema changed. **No** check-in/QR security logic changed.
- The Timesheet feature (separate deliverable, already complete) was **not** touched.

## 13. Verification Matrix

| Gate | Command | Result |
| ---- | ------- | ------ |
| TypeScript (noEmit) | `npm run lint` (`tsc --noEmit`) | PASS (0 errors) |
| Frontend unit suite | `npm test` (`vitest run`) | 12 files, **115/115** PASS (13 new scanner tests) |
| Production build | `npm run build` | PASS (~3.3 s; pre-existing 500 kB chunk-size advisory only) |
| Backend suite | `py manage.py test` (`backend/`) | **439/439** PASS ("Ran 439 tests … OK") |
| Migration drift | `py manage.py makemigrations --check --dry-run` | "No changes detected" |
| Mocked browser E2E | live app on `vite preview` (port 3000) + backend (127.0.0.1:8000), injected `canvas.captureStream` | SEE item 21 checklist |

## 14. Files Changed

- `src/features/student/StudentQRScannerView.tsx` — rewritten camera lifecycle (state machine,
  `ideal` facing mode, honest errors, double-activation guard, kill-switch cleanup).
- `src/features/student/StudentQRScannerView.test.tsx` — NEW: 13 jsdom regression tests.
- `package.json` / `package-lock.json` — devDependency `jsdom` added (test-only).
- `docs/09-QR-ATTENDANCE.md`, `docs/08-ATTENDANCE-SYSTEM.md` — camera scanner behavior +
  deployment requirement documentation.
- `docs/CAMERA_SCANNER_AUDIT_REPORT.md` — this report.
- `.playwright-mcp/camera-live-preview.png` — evidence capture from the mocked browser run.

## 15. Tests Added (regression coverage)

`StudentQRScannerView.test.tsx` (all passing; jsdom environment):

1. `cameraErrorMessage` maps each failure name to its distinct, honest message.
2. Idle render — no `<video>` element, Activate button present.
3. Granted stream is attached to `<video>` and the UI shows LIVE PREVIEW.
4. `NotAllowedError` → distinct message; stream stopped.
5. `NotFoundError` → distinct message.
6. `NotReadableError` → distinct message.
7. Blocked autoplay (`play()` rejection) → error state, stream stopped, `srcObject` nulled.
8. If the stream never resolves, the view never claims "active".
9. Stop then restart → new `getUserMedia` call, fresh stream attached.
10. Unmount during live state → all tracks stopped, `srcObject` nulled.
11. Orphan case (stream resolves after unmount) → track stopped, never attached.
12. Double activation while pending → single acquisition.
13. Insecure context → HTTPS message, `getUserMedia` not called.

## 16. Backward Compatibility

- No API contract change: `POST /api/attendance/qr/check-in/` request/response unchanged; the manual
  token entry (BARE and FULL `AAMSQR1|…` payloads) behaves exactly as before.
- No database change; no migration produced (confirmable via item 13).
- Sensible defaults preserved; any previously-stored attendance/QR data is unaffected.

## 17. Risks & Residuals

- **Medium residual (accepting, documented):** physical-camera behavior not verifiable in this
  environment (item 5). Because the fix normalizes the exact branch that was previously dead
  (attach-after-resolve), a physical regression would surface as hardware/permission-specific rather
  than structural.
- **Low residual:** the decode box runs `jsQR` frames in `active`; decode accuracy depends on the
  physical device's focus/distance (classroom board). Unchanged from before the fix, and not hardware
  testable here — recommend a quick on-device classroom smoke test during deployment.
- **Very low:** `releaseStream()` may call `track.stop()` on the same loosely-held track via both the
  video-attachment path and the `streamRef` path; `stop()` is idempotent in browsers (no observable
  effect).

## 18. Non-Goals / Out of Scope (explicit)

- No UI redesign, no color/nav/layout work.
- No "phase J" or new backend capability.
- No redesign of the attendance/QR check-in security model.
- No offline/queued attendance work.
- No dependency upgrades beyond the test-only `jsdom` addition.

## 19. Surfaces Using the Scanner (complete inventory)

- `src/features/student/StudentQRScannerView.tsx` — **only** camera consumer in the repository
  (verified by grep for `getUserMedia` / `srcObject` / `userMedia`).
- Mounted once, at the student route `'qr-scanner'` in `src/App.tsx`.
- No admin/teacher surface uses the camera; `LiveQRPane` is display-only (generates the QR).

## 20. Reporting Honesty

- All claims above are limited to what was actually exercised: code-level, unit-level, and
  mocked-browser-level behavior. The heading in item 5 and the matrix in item 21 state the mocked vs.
  physical distinction explicitly. No hardware-only claim is made.

## 21. Mocked-Browser Verification Checklist (what the browser run actually demonstrated)

Live run: `vite preview` (port 3000) serving the rebuilt `dist`, real backend on 127.0.0.1:8000,
logged in as `std-1`; `navigator.mediaDevices.getUserMedia` injected with a genuine stream from
`canvas.captureStream()`.

| # | Step | Observed result |
| - | ---- | --------------- |
| 1 | Load QR Attendance | Idle view renders: "Camera Viewfinder Idle" + "Activate Device Camera", no `<video>` |
| 2 | Click Activate | `<video>` present; `srcObject` = provided stream; `readyState` 4; playing; `videoWidth` 320 |
| 3 | UI transition | "LIVE PREVIEW" chip + "Stop Camera" visible; viewfinder no longer idle |
| 4 | Click Stop | `video` removed from DOM; track(s) `stop()` invoked; view returns to idle |
| 5 | Activate again | Fresh acquisition; LIVE PREVIEW returns (restart works) |
| 6 | Inject `NotFoundError` → Retry | "No camera device was detected on this device. …" message |
| 7 | Inject `NotAllowedError` → Retry | "Camera permission was denied. Allow camera access …" message |
| 8 | Inject `NotReadableError` → Retry | "The camera is currently in use by another application. …" message |
| 9 | Restore stream → Retry | Recovers to LIVE PREVIEW (Retry re-runs the pipeline) |

Screenshot evidence: `.playwright-mcp/camera-live-preview.png`.

## 22. Ops / Rollout Notes

- Frontend rebuild required (dist hash changed) — `npm run build`; restart `vite preview` if it was
  pinned to a port in your CORS allowlist (backend `CORS_ALLOWED_ORIGINS` — local dev used
  `http://localhost:3000`).
- Deployment must be HTTPS (secure context) or the scanner will deliberately show the honest
  "Camera access requires HTTPS (or localhost)" error.
- No DB migration; no backend restart requirement beyond Django's normal runserver reload for the
  already-running process.

## 23. Artifacts

- This report: `docs/CAMERA_SCANNER_AUDIT_REPORT.md`.
- Screenshot: `.playwright-mcp/camera-live-preview.png`.
- Regression suite: `src/features/student/StudentQRScannerView.test.tsx` (13 tests).

## 24. Documentation Updated

- `docs/09-QR-ATTENDANCE.md` — new "Camera Scanner browser behavior" section (state machine,
  root-cause note, error table, secure-context deployment requirement, mocked-vs-physical verification
  note).
- `docs/08-ATTENDANCE-SYSTEM.md` — scanner lifecycle line under What Works.
- `docs/CAMERA_SCANNER_AUDIT_REPORT.md` — this report.

## 25. Sign-off / Status

| Aspect | Status |
| ------ | ------ |
| Root cause | CONFIRMED (element-render circularity; see item 6) |
| Fix | IMPLEMENTED |
| Unit + mocked-browser tests | PASS (item 13, item 21) |
| Backend + migration gates | PASS (439 tests; no changes) |
| Physical-camera verification | **PENDING** (manual, deployment-time; item 5) |
| Docs | UPDATED (item 24) |