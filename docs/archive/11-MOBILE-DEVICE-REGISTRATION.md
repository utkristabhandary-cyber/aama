# AAMS — Mobile / Companion Device Registration

## Status: IMPLEMENTED (backend + Android registration binding)

## Purpose

Bind installations of the desktop companion (teacher) and the mobile app (student) to server-side device records so identity is not merely a client-supplied claim, and to enable network-anchor workflows and (future) push.

## Backend Model — `DesktopCompanionDevice` (`apps/companion`)

- `teacher` (FK), `device_name`, registration token/secret, `last_seen`, `active` (default True), `revoked` (default False)
- `is_active()` — not revoked
- Clean: unique `teacher`+`device_name`

Approved with a server-side token/secret per device; desktop must re-register if revoked.

## Backend Model — `StudentCompanionDevice` (`apps/companion`)

- `student` (FK), `device_name`, fingerprint, attestation/registration token, `is_active`, `created_at`
- Used to track/approve a student's physical device for check-ins.

## Companion Registration Flow

1. `POST /companion/register/` (teacher) — desktop claims a unique device for its first run; returns device token/secret.
2. Heartbeat/status calls authenticate with the device.
3. Start-session (`/companion/desktop/start-session/`) can anchor the attendance session to the desktop teacher's network.

## Mobile Registration Flow (student)

`DashboardActivity.registerDevice()` → `POST /companion/mobile/register/` with device name + optional fingerprint; returns/records approved device. Called on dashboard load; stored via `SecureStorage`.

## Network Anchors — `TeacherNetworkAnchor`

`ssid`, `bssid`, `trust_level` — teacher-registered known-good classroom networks; used as `teacher_anchor_verified` evidence in check-in policy.

## Permissions / Auth

- Companion endpoints: `IsAuthenticatedTeacher` (with per-device binding via `request.device` where applicable).
- Mobile register: `IsStudentUser`.

## What Works

- Desktop device registration/revocation; student mobile registration.
- Companion start/heartbeat/stop-session tied to anchored network; mobile registration bound to student.

## Missing / Notes

- Physical-device acceptance flow not yet verified (register + anchor on real hardware).
- No device push token endpoint yet (would be needed for teacher-mobile sync notifications later).
- No per-device audit/history screen in UI (backend only).
