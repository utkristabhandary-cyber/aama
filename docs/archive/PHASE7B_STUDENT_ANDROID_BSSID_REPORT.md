# Phase 7B — Student Android BSSID Verification

**Status: PARTIALLY COMPLETE**

- Backend Phase 7B: **COMPLETE** (implemented, migrated, tested — 193/193 backend tests pass).
- Android app Phase 7B: **COMPLETE as code** (compiles, unit tests pass, APK builds).
- On-device verification: **NOT DONE** — no physical Android device and no emulator/system images are available in this environment. Everything that requires real Wi-Fi hardware is unproven (see Section 7).

Phase 7A behavior is fully preserved. Django remains the single authority for whether a check-in succeeds; a client can never mark itself network-verified.

---

## 1. Implementation Summary

Phase 7B adds a native Kotlin/Android student app that captures the phone's **real** Wi-Fi BSSID through legitimate OS APIs (`WifiManager.getConnectionInfo()` on Android 8–12, `WifiManager.connectionInfo` under the `NEARBY_WIFI_DEVICES` (neverForLocation) permission on Android 13+) and submits it to the existing `POST /api/attendance/qr/check-in/` endpoint. Django compares the reported BSSID against the Phase 7A `TeacherNetworkAnchor` that the teacher's desktop companion anchored to the classroom Wi-Fi. Only an exact match accepts attendance (`teacher_anchor_verified`); anything else is rejected with a structured `403` (`networkVerificationRequired` or `networkMismatch`).

Key trust design:

- BSSID evidence is **OS-observed, application-reported** — deliberately NOT "cryptographically attested" (no Play Integrity dependency).
- Provenance/attribution only: the app registers a per-installation UUID via `POST /api/companion/mobile/register/` (new `StudentCompanionDevice` table) and sends it back on check-in in the `X-AAMS-Mobile-Device-ID` header. Registration grants **zero** network-verification rights.
- `resolve_network_verification()` downgrades every client-reported claim to `unavailable` unless the request came from a registered app installation for that user AND `AAMS_TRUST_OS_ATTESTED_NETWORK` is enabled (default `true`, kill-switch via env `AAMS_TRUST_OS_ATTESTED_NETWORK=false`).
- The teacher-anchor comparison (Phase 7A) is untouched and remains the deciding gate.

Verified behaviors (background via real E2E Django tests, not mocks):

| Scenario | Result |
|---|---|
| Anchored session + registered device reporting the **matching** BSSID | `201 teacher_anchor_verified`, bssid stored on the record |
| Anchored session + registered device reporting a **different** BSSID | `403 networkMismatch` |
| Anchored session + no/unknown mobile device header | `403 networkVerificationRequired` |
| Anchored session + `AAMS_TRUST_OS_ATTESTED_NETWORK=false` | downgraded to `unavailable` -> `403 networkVerificationRequired` |
| Unanchored session + registered device | `201` method `bssid` (Phase 6 behavior for honest clients) |
| Mobile device registration | student `201`/`200` (reactivate), teacher `403`, anonymous `401` |

---

## 2. Files Changed

### Backend (Phase 7B)
- `backend/apps/companion/models.py` — new `StudentCompanionDevice` model.
- `backend/apps/companion/migrations/0002_studentcompaniondevice.py` — CreateModel migration (**applied to `aams_db`**).
- `backend/apps/companion/serializers.py` — `StudentCompanionDeviceSerializer`, `CompanionMobileRegisterRequestSerializer`.
- `backend/apps/companion/views.py` — `mobile_register` view (student-only).
- `backend/apps/companion/urls.py` — `path("mobile/register/", ...)`.
- `backend/apps/companion/services.py` — `register_mobile_device()`, `resolve_mobile_device()`.
- `backend/apps/companion/tests.py` — mobile-registration tests + real check-in E2E for attested paths.
- `backend/apps/attendance/services.py` — `resolve_network_verification(network, attested=False)`; `check_in_student(..., attested_device=False)`.
- `backend/apps/attendance/views.py` — `check_in` action resolves the mobile device header and passes `attested_device`.
- `backend/config/settings/base.py` — `AAMS_TRUST_OS_ATTESTED_NETWORK` (default `true`).

### Android (`mobile/`)
- Root: `settings.gradle.kts`, `build.gradle.kts`, `gradle.properties` (includes `android.overridePathCheck=true` — the parent path contains an em-dash which AGP's path check otherwise rejects), `local.properties` (SDK dir only), `gradle/wrapper/*`, wrapper `gradle-wrapper.jar`/`gradle-wrapper.properties`.
- `app/build.gradle.kts` — namespace `com.aams.student`, minSdk 26, compile/target 34, pinned cached dependencies (CameraX 1.3.1, ZXing core 3.5.1, OkHttp 4.11.0, security-crypto 1.1.0-alpha06, coroutines 1.7.3, appcompat 1.7.0, junit 4.13.2), `AAMS_BASE_URL` BuildConfig (debug `http://10.0.2.2:8000`).
- `app/src/main/AndroidManifest.xml` — INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, CAMERA, `ACCESS_FINE_LOCATION` (maxSdkVersion 32), `NEARBY_WIFI_DEVICES` (`neverForLocation`, API 33+), cleartext only via `@bool/allow_cleartext_traffic` (main=false, debug=true).
- `app/src/main/res/` — strings, colors, themes, adaptive launcher icon.
- Kotlin sources (`com/aams/student/`):
  - `network/BssidNormalizer.kt` — mirrors backend normalization rules (`^[0-9A-Fa-f]{12}$`).
  - `network/NetworkEvidence.kt` — data class + `toNetworkJson()`.
  - `network/NetworkVerificationManager.kt`, `NetworkPermissionHelper` — per-API permission handling, masked/zero-BSSID rejection, `SecurityException` -> `unavailable` (fail secure).
  - `qr/QrPayloadParser.kt`; `qr/QrScanAnalyzer.kt` (CameraX + ZXing).
  - `api/ApiClient.kt`, `api/ApiModels.kt`, `api/AuthApi.kt`, `api/AttendanceApi.kt` (registerDevice, checkIn with header + outcome parsing).
  - `storage/SecureStorage.kt` (EncryptedSharedPreferences, AES256); `auth/SessionManager.kt` (token, per-installation UUID).
  - `attendance/CheckInRepository.kt` — captures fresh network evidence at submit time (never cached).
  - `MainActivity.kt`, `ui/LoginActivity.kt`, `ui/DashboardActivity.kt`, `ui/ScanActivity.kt`.
- `app/src/test/java/com/aams/student/` — `network/BssidNormalizerTest.kt` (10 cases), `qr/QrPayloadParserTest.kt` (10 cases).

### No changes to Phase 7A code paths
`create_network_anchor`, `heartbeat_check`, anchor gate, QR start/stop, teacher companion endpoints are unchanged.

---

## 3. API Changes

### New: `POST /api/companion/mobile/register/`
Auth: student only (ExpiringToken). Body (both optional):
```json
{ "device_id": "<uuid>", "device_name": "<string>" }
```
Response `201` (created) / `200` (reactivated):
```json
{ "device": { "device_id": "...", "device_name": "...", "is_active": true, "last_seen_at": "..." }, "created": true }
```

### Changed: `POST /api/attendance/qr/check-in/`
- New optional header `X-AAMS-Mobile-Device-ID: <uuid>` — the app's registered installation id. Unknown/inactive/headers-not-matching-user are treated as "not a registered app" (hint: no check-in boost; lowered to `unavailable`).
- `network` payload: `{ "method": "bssid", "bssid": "aa:bb:cc:dd:ee:ff" }`. Only a registered app keeps `method="bssid"`; all other clients (including browsers) are downgraded to `unavailable`.
- Outcome keys added earlier in Phase 7A remain the same: `201` with `teacher_anchor_verified`, `403` with `networkVerificationRequired` / `networkMismatch`, `200 alreadyRecorded` for duplicates (idempotent).

### No auth contract changes
`POST /api/auth/login/ -> {"token", "user"}`, `Authorization: Token <key>`, student username = college student ID, `POST /api/auth/logout/`, `GET /api/auth/me/`.

---

## 4. Database Changes

`StudentCompanionDevice` (`companion.0002_studentcompaniondevice`):
- `device_id` — UUIDField (app-generated per-installation).
- `user` — FK to the student account.
- `device_name` — CharField (blank).
- `is_active`, `last_seen_at` — device lifecycle.
- `created_at`.

Migration applied to `aams_db`; DB was **not** reset; `makemigrations --check --dry-run` is clean. No write to any existing Phase 7A table.

---

## 5. Mobile Changes

The app: install → login (Token) → home → camera QR scan of the teacher's screen → check-in → result.

- **Evidence capture**: immediate before each submit inside `CheckInRepository`; uses `WifiManager.connectionInfo` (Android < 33) or the `NEARBY_WIFI_DEVICES` path (33+). Requires granted `ACCESS_FINE_LOCATION` (8–32) / `NEARBY_WIFI_DEVICES` (33+) plus a toggled-on location service on Android 8–12. Any unavailability (no Wi-Fi, masked `02:00:00:00:00:00` / `00:00:00:00:00:00`, null, `SecurityException`) reports `method: "unavailable"` securely rather than guessing.
- **Storage**: token + per-installation UUID in `EncryptedSharedPreferences` (AES256) — the UUID is never a secret, only an identifier.
- **Payload handling**: `QrPayloadParser` strict-regex parses `AAMSQR1|<id>|<TOKEN>` for display only; authorization stays server-side.
- **Server URL**: debug defaults to `http://10.0.2.2:8000` (emulator loopback), overridable; release uses an HTTPS placeholder — cleartext is gated per-build-type.

---

## 6. Testing

- **Backend**: `python manage.py test` full suite **193/193 OK** (includes new `StudentMobileRegistrationTests` + attested-network E2E class, 45 companion tests). `makemigrations --check --dry-run` exit 0.
- **Frontend**: `npm run lint` (tsc) pass, `npm run build` pass (unchanged).
- **Android unit tests**: `BssidNormalizerTest` + `QrPayloadParserTest` pass **20/20** (JUnitCore run directly on the JVM; the exact command is in Appendix B).
- **Android build**: `gradlew :app:assembleDebug` succeeds; `app/build/outputs/apk/debug/app-debug.apk` produced.
- **Not executed**: anything requiring a device/emulator (Section 7).

---

## 7. Physical Device Requirement (why PARTIAL)

No physical Android device and no emulator system images are installed, so the following **must** be verified on real hardware before this can be called complete:

1. Install `app-debug.apk` (or a release signed APK) on an Android 8–12 device and on an Android 13+ device.
2. Grant permissions; confirm the permission-request flow and that the location-toggle requirement on Android 8–12 is surfaced correctly.
3. Join the classroom Wi-Fi the teacher anchored; scan the teacher's QR and confirm `201 teacher_anchor_verified`.
4. Repeat while on a **different** network → `403 networkMismatch`; with Wi-Fi off / location off → `403 networkVerificationRequired` (fail-secure, no crash).
5. Restart the app and re-check-in; confirm `200 alreadyRecorded` and that the UUID persists across restarts (same device row reactivated).
6. Ride through the Android 13 permission path (`NEARBY_WIFI_DEVICES`) with the toggle behaviors.
7. Optionally test a proxy/HTTPS deployment so cleartext debugging is not relied on.

---

## 8. Known Issues

1. **Gradle test worker cannot load test classes (`:app:testDebugUnitTest`)** — every attempt fails fast (it does **not** hang) with `ClassNotFoundException`/`initializationError` for the correctly-compiled test classes. The debug log shows the worker's "application classpath" with the project pathname (which contains an em-dash); direct JVM execution with the exact same class list passes 20/20, so this is an environment-specific Gradle-worker classloading issue with the non-ASCII project path, not a code or test defect. `-Dfile.encoding=UTF-8` (daemon + test JVM), `--no-daemon`, and encoding properties inside `testOptions` were all tried. Tests are kept; the recommended run path is the direct JVM command (Appendix B). A future fix could move the project to an ASCII path (e.g., `C:\aams`) and re-run `gradlew :app:testDebugUnitTest`.
2. **Attestation is not cryptographic (by design)** — a student who knows the classroom BSSID (and has any registered app id) can report it from anywhere; the OS observes it, the transport cannot prove presence. Mitigations: `AAMS_TRUST_OS_ATTESTED_NETWORK` kill switch, the server-side anchor compare, and (future) Play Integrity attestation.
3. **Device header is attribution, not authorization** — a modified client can present `X-AAMS-Mobile-Device-ID` values; the server only honors device ids registered to that user and grants no verification rights. This is documented in code.
4. **Unbounded per-student device registration** — a student can register unlimited device rows (no cap/rate limit yet). Impact is Low (accountability-noise/DoSt) — see Appendix A, AAMS-MOB-01.
5. **Debug build talks cleartext HTTP** — intended for emulator only; release should use HTTPS (BuildConfig placeholder).
6. **Pre-existing environment limits** — no AVD/system images; Vercel-hosted frontend integration is out of scope for this phase.

---

## 9. Next Recommended Phase

1. Run the physical-device checklist (Section 7) and adjust the permission/UX flow based on findings.
2. Optionally add Play Integrity (or a lightweight nonce+signature handshake) to raise the assurance level of "attested" past the current OS-observed/application-reported ceiling.
3. Add rate limiting / per-user device caps on `mobile/register/` and check-in to close AAMS-MOB-01/05.
4. Re-run `:app:testDebugUnitTest` after relocating the repo to an ASCII path to prove the Gradle-worker issue is the non-ASCII path.
5. Add release keystore config + HTTPS URL + certificate pinning for production.

---

## Appendix A — Phase E Security Audit (Phase 7B surface)

Scope: the new Phase 7B trust boundaries. Baseline Django hardening (DEBUG/SECRET_KEY/ALLOWED_HOSTS fail-closed, ExpiringToken, constant-time token compare, ORM-only SQL) was previously in place and is unchanged; pre-existing "run `manage.py check --deploy` for prod" note carries forward.

Findings (most-significant first):

**AAMS-MOB-01 — Low — Unbounded student device registration**
Location: `backend/apps/companion/views.py:351-378` (`mobile_register`), `backend/apps/companion/services.py:191-217`.
Evidence: `register_mobile_device` creates a row whenever `device_id` is absent or unknown; there is no per-user cap.
Impact: an authenticated student can fill the `StudentCompanionDevice` table (storage/noise in accountability data). Not an authorization bypass.
Fix: cap active devices per student (e.g., 5) and/or return the existing id on repeat UUIDs; add rate limiting.
Mitigation (already present): device rows grant no verification rights, so abuse has no attendance impact.

**AAMS-MOB-02 — Info — Attestation ceiling is "OS-observed, application-reported"**
Location: `backend/apps/attendance/services.py:177-216` (`resolve_network_verification`).
Evidence: an attested `bssid` survives downgrade on client claim; the value is later compared in `check_in_student` (`services.py:300-319`). Wording throughout is deliberately not "cryptographically attested".
Impact: a determined student can assert a known classroom BSSID from anywhere. Server still rejects mismatches; the design treats this as an accepted residual risk.
Fix/mitigation: keep `AAMS_TRUST_OS_ATTESTED_NETWORK` disabled (env `false`) unless the policy accepts this residual; future Play Integrity. The recorded `network_verification_method`/`bssid_normalized` columns (set at `services.py:337-338`) preserve an audit trail of the exact claim used.

**AAMS-MOB-03 — Info — Mobile device header is spoofable but inert**
Location: `backend/apps/companion/services.py:220-239` (`resolve_mobile_device`).
Evidence: `X-AAMS-Mobile-Device-ID` is read at `services.py:229`; lookup is scoped to `user=request.user` and `is_active=True` (`services.py:233-237`); the caller only uses it to set `attested_device` (`backend/apps/attendance/views.py:539`).
Impact: a client can name any id, but only this user's owned, active device rows are honored, and no privilege follows from the header. Safe-by-design; noted for future maintainers not to turn this header into an authorization signal.

**AAMS-MOB-04 — Info — Differential response markers are intentional**
Location: `backend/apps/attendance/services.py:282-318`.
Evidence: `networkVerificationRequired` (no evidence) vs `networkMismatch` (evidence ≠ anchor) are returned as distinct keys; neither message reveals `anchor.bssid_normalized` (expected value never echoed).
Impact: students learn *whether* the session is anchored and *whether* their claim matched — this is the documented UX contract (Section 3). No BSSID value is disclosed.

**AAMS-MOB-05 — Low — No brute-force rate limit on repeated check-in probes**
Location: `backend/apps/attendance/views.py:539` (check_in) — no throttling class in `REST_FRAMEWORK` defaults (`settings/base.py:191-200`).
Impact: an authenticated student could poll an anchored session's responses; beyond the reduced-oracle above there is nothing to gain (markers are intentional). Standard DoS hygiene for production.
Fix: DRF `ScopedRateThrottle` on `check_in` and `mobile/register`.

**AAMS-MOB-06 — Low — Broad exception handler (pre-existing, outside 7B but adjacent)**
Location: `backend/apps/companion/views.py:64` (`_get_device` catches bare `Exception`).
Impact: masks programming errors into a generic 403; safe default (deny) but hides bugs.
Fix: narrow to `(DoesNotExist, ValueError)` as the mobile path does.

No sql-injection, XSS, command-injection, open-redirect, or secret-exposure findings were introduced in Phase 7B.

---

## Appendix B — Reproducing the Android unit tests

`gradlew :app:testDebugUnitTest` is currently broken by a Gradle-worker/environment issue (Known Issues #1). Proven alternative that exercises the exact compiled test classes:

```powershell
$mobile = "C:\Users\utkri\OneDrive\Desktop\aams\aams-—-academic-attendance-management-system\mobile"
$cp = "$mobile\app\build\tmp\kotlin-classes\debugUnitTest" +
      ";$mobile\app\build\tmp\kotlin-classes\debug" +
      ";C:\Users\utkri\.gradle\caches\modules-2\files-2.1\junit\junit\4.13.2\8ac9e16d933b6fb43bc7f576336b8f4d7eb5ba12\junit-4.13.2.jar" +
      ";C:\Users\utkri\.gradle\caches\modules-2\files-2.1\org.hamcrest\hamcrest-core\1.3\42a25dc3219429f0e5d060061f71acb49bf010a0\hamcrest-core-1.3.jar" +
      ";C:\Users\utkri\.gradle\caches\modules-2\files-2.1\org.jetbrains.kotlin\kotlin-stdlib\1.9.22\d6c44cd08d8f3f9bece8101216dbe6553365c6e3\kotlin-stdlib-1.9.22.jar"
& "$env:JAVA_HOME\bin\java.exe" -cp $cp org.junit.runner.JUnitCore `
  com.aams.student.network.BssidNormalizerTest com.aams.student.qr.QrPayloadParserTest
```

Result: `OK (20 tests)`.