# AAMS — QR Attendance

## Status: IMPLEMENTED

## Overview

Rolling-token QR roll-call. A teacher starts a QR session and displays the rolling token on the classroom screen; students scan it with their web camera (or read it) to check in. Tokens rotate on a TTL, are validated constant-time, and are tied to a single active session per teacher.

## Token Format

- Payload: `AAMSQR1|<attendance_session_id>|<TOKEN>`
- Token: 8 chars, uppercase alphanumeric with a separator for readability (e.g. `8F3K-29PA`).
- `parse_qr_payload` → validate prefix `AAMSQR1` on `|` splits.

## Authoritative Check-In Chain (`check-in/`)

Request: `{qr_payload, network_evidence}`.

Server-side, in order:

1. **Parse & validate** QR payload (format, structure).
2. **Token freshness** — `token_is_current` (constant-time) against the active QR session; auto-rotate after `AAMS_QR_TOKEN_TTL_SECONDS` (default 15s). Fresh tokens accepted; stale tokens, or a new token already generated (someone else scanned) → rejected with a clear error so the user knows the code has rotated.
3. **Attendance-session linkage** — token's session must be valid & not finalized.
4. **Enrollment check** — student must belong to a section in the session.
5. **Network policy** — because browsers cannot OS-attest a classroom network, the recorded method is always `unavailable`; any client-claimed `bssid` / `mobile_network_bridge` evidence is rejected. No teacher anchor exists (removed in Phase 2).
6. **Sports/duplicate handling** — if already recorded w/ present → 200 "already"; token reuse → error; normal → 201.

Response: `201` / `200` (already) / `400` / `404` as appropriate.

## Rotation & Revocation

- `start_qr_session` creates `QRAttendanceSession` (one active per teacher via partial unique index).
- `get_current_token()` rotates if older than TTL.
- `rotate()` advances token and clears the per-token student ledger.
- `stop_qr_session` revokes (`revoked=True`) and disallows further check-ins.
- One active QR per teacher; starting a new one stops the previous (ledger reset).

## Duplicate / Replay Protection

- `check_in_student` is idempotent per (session, student): a student already marked present returns `200 already` without writing again.
- Token replay from a different student for the same active token is detected via the ledgers in `token_is_current` and cleared on rotate.
- Rate limiting: QR high-traffic path throttling in settings.

## Frontend

### Web (student)
- `StudentQRScannerView` (`src/features/student/`) — camera scan + check-in; network evidence always reports `unavailable`.
- `LiveQRPane` (`src/features/attendance/`) — teacher-side rolling-token display, rendered with `qrcode`.

## Camera Scanner (`StudentQRScannerView`) — browser behavior

The scanner viewfinder runs a four-state machine: `idle → initializing → active`, with `error` reachable
from `initializing`. `cameraErrorMessage()` maps `getUserMedia` failures to specific, user-actionable text.

States & UI:

| State         | UI                                                            |
| ------------- | ------------------------------------------------------------- |
| `idle`        | "Activate Device Camera" button (no `<video>` mounted)        |
| `initializing`| Spinner + "Initializing camera…", `<video>` already mounted   |
| `active`      | "LIVE PREVIEW" chip, crosshairs, "Stop Camera" button         |
| `error`       | "Camera Unavailable" + cause-specific message + Retry button  |

A bad state sits behind the honest message. Root-cause fix: the `<video>` element is now mounted as soon
as `cameraState !== 'idle'`, so the element exists (ref is set) by the time `getUserMedia` resolves and
the stream can be attached. Previously the element was only rendered when already active — a circularity
that meant the stream never attached and the viewfinder stayed idle forever while the granted camera
stream was orphaned (camera LED on, no UI to stop it).

Behaviors baked in:

- `facingMode: { ideal: 'environment' }` — aspirational, never a hard constraint. A hard constraint throws
  `OverconstrainedError` on devices with no rear camera; `ideal` falls back to any available camera.
- `video.play()` is awaited (autoplay blocked → error state, stream stopped rather than silently dead).
- `releaseStream()` stops the track(s) attached to the video **and** any stream still waiting to be
  attached (unmount-during-prompt), then nulls `srcObject`. A `startingRef` guard prevents double-start.
- Explicit "Stop Camera" + unmount cleanup both release the stream.
- Permissions are request-scoped: real browsers keep the grant until the stream is stopped.

### Browser / deployment requirements
- The viewfinder requires a **secure context** (`window.isSecureContext === true`). AAMS runs on HTTPS in
  deployment and `http://localhost` in local development. Non-secure pages show an honest
  "Camera access requires HTTPS (or localhost)" message instead of a silent failure.
- First activation triggers the browser's permission prompt; denial maps to a clear "Allow camera access"
  message with a Retry button.
- Verification of the camera flow in an automated/hardware-less environment is performed with a
  **mocked `getUserMedia`** (e.g. `canvas.captureStream`). Physical-camera verification on a real device
  remains a deployment-time manual step (see `CAMERA_SCANNER_AUDIT_REPORT.md`).

## What Works

- Rolling token rotation, constant-time validation, single-active-per-teacher, server-authoritative identity, idempotent check-ins, stop/revoke, and re-target persistence (starting a QR on a second session within the same run persists the new `attendance_session`).
- Camera scanner lifecycle: activate → live preview, stop/restart, stream cleanup on unmount, honest error
  mapping for permission-denied / no-device / busy / insecure-context. Unit + mocked-browser verified.
- Backend validation + unit tests (see `21-TESTING.md`).

## Notes

- End-to-end flow was verified against a live backend (teacher start → student scan → record written → stop → replay rejected) in the Phase 2 web-only verification.