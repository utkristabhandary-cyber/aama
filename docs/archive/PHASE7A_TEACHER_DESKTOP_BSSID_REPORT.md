# PHASE 7A — Teacher Desktop BSSID Anchor (Companion App)

**Feature:** The teacher's Windows laptop becomes the *authoritative* source of the
classroom Wi-Fi network identity for an attendance session. A desktop companion app
reads the real Wi-Fi BSSID the laptop is connected to, registers the laptop with the
backend, and locks ("anchors") an active QR attendance session to that BSSID. Django
then enforces the anchor at check-in time so that only a student device on the same
classroom network can be recorded as network-verified.

**Phase goal (from the task):**
> "Windows desktop companion app ... capture the actual Wi-Fi BSSID ... authored by
> the teacher's laptop ... Let Django compare the authoritative teacher-session BSSID
> against the student's verified BSSID."

---

## Status

| Item | Status |
| --- | --- |
| Desktop companion app (Windows, PySide6) | **COMPLETE** |
| PyInstaller packaged executable build + smoke test | **COMPLETE** |
| Companion registration / device identity backend | **COMPLETE** |
| Teacher network anchor storage + one-time binding | **COMPLETE** |
| Browser cannot establish the teacher anchor | **COMPLETE** |
| Heartbeat network-change detection → anchor invalidation | **COMPLETE** |
| Django-side anchor enforcement at check-in | **COMPLETE** (comparison code live; see note) |
| **Real student-device BSSID == teacher anchor BSSID proof** | **PARTIALLY COMPLETE** — no OS-attested student BSSID channel exists yet (Phase 7B native mobile). The comparison is implemented and tested at the service layer, but no student client can currently produce an attested BSSID, so browser check-ins under an anchored session are refused by design. |

---

## Architecture

```
 Teacher's Windows laptop                      Backend (Django/DRF)
 ┌──────────────────────────────┐              ┌─────────────────────────────────────┐
 │ AAMS-Teacher-Companion.exe   │  HTTPS/JSON  │ /api/companion/*                    │
 │  · PySide6 UI                │ ───────────► │  · register/        (device ID)     │
 │  · netsh wlan show interfaces│   bearer     │  · start-session/   (BSSID anchor)  │
 │  · BSSID + SSID of laptop's  │   Token +    │  · heartbeat/       (network watch)│
 │    Wi-Fi connection          │   X-Companion│  · stop-session/    (invalidate)    │
 │  · X-Companion-Device-ID     │   -Device-ID │  · status/                            │
 │    (local UUID, salted)      │              └───────────────┬─────────────────────┘
 └──────────────────────────────┘                              │ OneToOne
                                                               ▼
                                            TeacherNetworkAnchor
                                            (attendance_session, device,
                                             bssid_normalized, ssid,
                                             is_valid, invalidated_at, reason)
                                                               │
                                              attendance check-in  ▼
                                            check_in_student(): valid anchor ⇒
                                            require OS-attested student BSSID ==
                                            anchor, else 403
```

**Key guarantee (browser cannot anchor):** anchor-establishing endpoints require
`Authorization: Token <teacher>` **and** the `X-Companion-Device-ID` header, which only
the desktop process can produce from its locally-stored device identity. The browser's
JS code path cannot mint or hold that header the way the companion does, and any
attempt to do so (browser/student/anonymous request) is rejected server-side.

---

## Backend: data model and API

### Models (`backend/apps/companion/models.py`)

- **`DesktopCompanionDevice`** — `device_name`, `device_id` (UUID, unique), `device_fingerprint` (salted SHA-256 of host/user/platform/machine), `owner` (FK `accounts.User`, teacher), `is_active`, `last_seen_at`, `created_at`.
- **`TeacherNetworkAnchor`** — `attendance_session` (OneToOne `attendance.AttendanceSession`), `device` (FK `DesktopCompanionDevice`), `bssid_normalized` (canonical `aa:bb:cc:dd:ee:ff`), `ssid`, `captured_at`, `is_valid`, `invalidated_at`, `invalidation_reason`. One active anchor per session, forever.

### Endpoints (`/api/companion/`), all teacher-only + device-header-gated

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `register/` | POST | Register this laptop. First app flow; also re-activates an existing device_id. |
| `start-session/` | POST | Capture BSSID **now**, bind it to the attendance session (`teacher_anchor_valid`), and (re)start the QR. 201 returns the anchor + live QR data. |
| `heartbeat/` | POST | Assert still-connected BSSID. Network change during the session ⇒ anchor invalidated with reason `Network changed during active session.` |
| `stop-session/` | POST | Stop QR + invalidate the anchor (teacher finished early). |
| `status/` | GET | Active-session status for the app UI. |

### Anchor lifecycle rules (`apps/companion/services.py`)

- A **valid** anchor is immutable: `create_network_anchor` raises `PermissionDenied` rather than replace it.
- An **invalidated** anchor can be replaced by the same teacher/device (the same OneToOne row is updated, never duplicated).
- `start-session` also calls `start_qr_session`, so the existing Phase 6 QR flow stays intact.
- Finalized sessions, malformed BSSIDs, and all-zero/loopback BSSIDs are rejected.

### Check-in enforcement (`apps/attendance/services.py` → `check_in_student`)

After the existing Phase 6 gates the anchor gate runs:

1. No anchor or anchor is invalidated → **unchanged Phase 5/6 behavior** (browser `unavailable` check-ins still work).
2. Valid anchor + student method `unavailable` or no BSSID → **403** `networkVerificationRequired` (no OS-attested evidence).
3. Valid anchor + attested student BSSID ≠ anchor BSSID → **403** `networkMismatch`.
4. Valid anchor + attested student BSSID == anchor BSSID → **201**, method recorded as `teacher_anchor_verified`.

`resolve_network_verification` still downgrades *every* client claim to `unavailable`
(no student attestation channel is registered yet), so branch 4 is reachable today only
by a future Phase 7B native client — the comparison is implemented, unit-tested with a
stubbed attestation resolver, and ready.

> **Design choice, documented:** a session is anchored only when a teacher explicitly
> starts the companion. Until an OS-attested student channel exists, anchoring a
> session intentionally *blocks* browser-only check-ins on that session rather than
> recording them as `unavailable`. Teachers who do not use the companion are
> unaffected (full Phase 6 backward compatibility).

---

## Desktop companion (`desktop/`)

```
desktop/
├── main.py                        # entry point, single QApplication
├── build.spec                     # PyInstaller spec (console toggled via AAMS_COMPANION_DEBUG_CONSOLE)
├── requirements.txt               # PySide6, requests (+ pytest, pyinstaller as dev)
├── README.md
├── aams_companion/
│   ├── bssid.py                   # netsh wlan parse → NetworkIdentity (bssid/ssid)
│   │                              #   normalize_bssid, is_valid_bssid; rejects malformed + all-zero
│   │                              #   NotConnectedToWiFiError / NetworkIdentityError / PlatformNotSupportedError
│   ├── config.py                  # %LOCALAPPDATA%\AAMS\TeacherCompanion\companion_config.json
│   ├── device.py                  # UUID device_id + salted device_fingerprint (persisted)
│   ├── api.py                     # CompanionApiClient: login, register_device, start_session,
│   │                              #   heartbeat, stop_session, status, list_qr_sessions
│   ├── monitor.py                 # watchdog thread; heartbeat; fatal vs warning error handling
│   └── ui/
│       ├── style.py               # QSS styling
│       └── main_window.py         # LoginWidget / MainWidget / CompanionMainWindow; Signal(str,str)
└── tests/                         # 35 unit tests, no hardware/network dependency
```

### Behavior

- **BSSID is read at the moment a session is started**, not at app launch, so the
  anchor always reflects the network the laptop is on right now.
- Monitor thread polls the laptop's connection; `NotConnectedToWiFiError` is **fatal**
  (stops the session, invalidates the anchor), generic `NetworkIdentityError` is a
  **warning** and keeps polling.
- Heartbeats run on an interval and report `anchor_valid`; a BSSID change during an
  active session invalidates the anchor server-side.
- While a session is active the app shows the live network identity, the session list,
  the anchor banner, and an **"Open attendance page"** button that launches the existing
  Phase 6 web attendance page in the system browser (no second web UI, no in-app QR).

### Packaging

```
cd desktop
pyinstaller --noconfirm --clean build.spec
→ dist/AAMS-Teacher-Companion/AAMS-Teacher-Companion.exe
```

- Smoke-tested: the packaged `.exe` launches and stays running, then was shut down.
- Unsigned dev build ⇒ Windows SmartScreen warns on first run (expected; no
  code-signing certificate — none claimed).

### Config / server URL

The app stores its config under `%LOCALAPPDATA%\AAMS\TeacherCompanion\` and reads the
teacher's API base URL from there (defaults point at the deployment's backend).

---

## Security notes

- Teacher identity: standard `Token` auth via the existing `auth/login` endpoint.
- Device identity: `X-Companion-Device-ID` + fingerprint the browser cannot forge
  through the same channel; every anchor call is checked against both.
- Anchor is per-attendance-session, single-use, immutable while valid.
- Network change ⇒ automatic invalidation; the app surfaces it and the teacher restarts
  on the new network if intended.
- BSSIDs are normalized (lowercase `aa:bb:cc:dd:ee:ff`) and validated; malformed inputs
  are rejected, never stored.
- No client can self-report a "verified" method — `resolve_network_verification`
  downgrades all client claims to `unavailable` by design.

---

## Tests performed

| Suite | Result |
| --- | --- |
| Companion backend tests (`manage.py test apps.companion`) | 38 passed (registration, anchor creation/immutability/replacement, browser-cannot-anchor, heartbeat/invalidation, check-in enforcement incl. mismatch/match via stubbed attestation) |
| Full backend suite (`manage.py test`) | **186 passed** (no regression in Phase 5/6 attendance/QR flows) |
| `manage.py makemigrations --check --dry-run` | No changes detected |
| Desktop unit tests (`cd desktop && python -m pytest tests -q`) | 35 passed |
| PyInstaller build + exe smoke test | Passed |
| Frontend `npm run lint` / `npm run build` | Passed |

## Limitations / deferred

- **Same-BSSID equivalence is PARTIALLY COMPLETE**: the equality check is implemented
  and tested, but a real *student* OS-attested BSSID is impossible in a browser and a
  native student mobile app (Phase 7B) is out of scope here. Until then, anchored
  sessions refuse un-attested check-ins rather than faking it.
- The desktop app is Windows-only (`netsh`) by design of Phase 7A.
- `.exe` is unsigned; SmartScreen may warn.
- Anchor enforcement assumes the teacher starts the companion; it does not retroactively
  gate previously-recorded check-ins.

## How to run

```bash
# backend already running with migrations applied
cd backend
python manage.py runserver

# desktop app (dev)
cd desktop
python main.py

# packaged build
cd desktop
pyinstaller --noconfirm --clean build.spec
dist\AAMS-Teacher-Companion\AAMS-Teacher-Companion.exe

# tests
cd backend && python manage.py test          # full backend (incl. companion)
cd desktop && python -m pytest tests -q      # desktop unit tests
```