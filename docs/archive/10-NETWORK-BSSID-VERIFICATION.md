# AAMS — Network / BSSID Verification

## Status: IMPLEMENTED (backend + companion + student mobile) / PHYSICAL ACCEPTANCE TEST PENDING

## Concept

Tie QR check-in to the physical classroom Wi-Fi network so a student cannot check in from outside the room.

- **Phase 7A (Teacher Desktop Companion):** desktop app anchors the session to the classroom network by reporting the teacher's Wi-Fi BSSID/SSID as an "anchor."
- **Phase 7B (Student Android BSSID):** the student app captures and reports the Wi-Fi network it is on during check-in; server compares it against the session anchor.

Neither side's self-claim is trusted alone — the server correlates teacher-reported anchor with student-reported evidence and applies policy.

## Backend Models (`apps/companion`)

- `DesktopCompanionDevice` — teacher-registered desktop installations (device_name, last_seen, fingerprint/registration info, active/revoked).
- `TeacherNetworkAnchor` — teacher-registered network anchors (ssid, bssid, trust_level).
- `StudentCompanionDevice` — student-registered mobile installations (device_name, fingerprint, attestation/registration).

## Companion Endpoints (`/api/companion/`)

| Method | Path | Permission | Purpose |
|--------|------|-----------|---------|
| POST | `/companion/register/` | IsAuthenticatedTeacher | Register desktop device |
| GET | `/companion/desktop/status/` | Teacher | Heart/status incl. sessions |
| POST | `/companion/desktop/start-session/` | Teacher | Start attendance session on companion |
| POST | `/companion/desktop/heartbeat/` | Teacher | Heartbeat on anchor |
| POST | `/companion/desktop/stop-session/` | Teacher | Stop session |
| POST | `/companion/mobile/register/` | Student | Register Android install |

The phone/desktop network metadata (SSID, BSSID) is captured by the client natively and sent to the server; the server stores and uses it for anchor comparison.

## Network Evidence Resolution (server, `apps/attendance/services.py`)

`resolve_network_verification(evidence)` → `{method, bssid_normalized}`:
- `bssid` — BSSID hex normalized with `normalize_bssid`.
- `mobile_network_bridge` — phone used the teacher/hotspot network.
- `teacher_anchor_verified` — match against a recorded TeacherNetworkAnchor.
- `unavailable` — no Wi-Fi evidence (Android 13+ permission-restricted).

`normalize_bssid` normalizes `AA:BB:CC:...` → lowercase canonical form for comparison.

## Policy in `check-in/` (`app.check_in`)

- If the session has a verified anchor (from companion start-session or teacher anchor):
  - Network evidence is **required**.
  - Evidence must match a session-covered anchor (BSSID / ext SSID / bridge SSID); otherwise `403` network mismatch.
- If no anchor is present, QR+token control proceeds without network enforcement.

The companion "attend" call also records which network the teacher anchored to, stored so a later `check_in` can compare student evidence to it. Being merely "on some network" is never sufficient — evidence must correspond to a verified anchor.

## Mobile Capture (`mobile/app/.../network/`)

- `NetworkVerificationManager` — reads Wi-Fi info (SSID/BSSID), returns `NetworkEvidence{ssid, bssid, fingerprint}`.
- `NetworkEvidence` — carries the captured network.
- `BssidNormalizer` — normalizes captured BSSID.

Android manifest declares `CAMERA`, `ACCESS_WIFI_STATE`, `ACCESS_FINE_LOCATION` (maxSdk 32), `NEARBY_WIFI_DEVICES` (for post-33).

## What Works (code-verified)

- Anchor registration, start/heartbeat/stop-session, mobile device registration.
- Server-side normalization + policy enforcement on check-in.
- Student mobile BSSID capture wired into the check-in payload.
- Unit tests for services (companion + attendance).

## What's Pending

- **Physical-device acceptance test** of teacher anchor + student phone on the same/different Wi-Fi to confirm real-world E2E (temp `192.168.1.73:8000` debug base URL; real LAN deployment not yet exercised). Code complete.
