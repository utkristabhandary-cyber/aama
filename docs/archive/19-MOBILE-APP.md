# AAMS — Mobile App (Android) & Desktop Companion

## STATUS LEGEND
- Student Android app: **PARTIALLY IMPLEMENTED** (login/QR/BSSID/register working; full module screens missing).
- Teacher mobile: **MISSING**.
- Desktop companion (Phase 7A): **IMPLEMENTED** (source + built EXE present; physical-device E2E not re-run here).

## Android App (`mobile/app`)

Project `AAMSStudent`, package **`com.aams.student`** (namespace/applicationId), minSdk 26, targetSdk 34, **native Android Views** (no Compose), Kotlin coroutines, CameraX + ZXing, OkHttp.

### Base URL
- Debug: `http://192.168.1.73:8000` (buildConfigField `AAMS_BASE_URL`).
- Release: `https://aams.example.invalid` (placeholder — MUST be replaced before release).

### Source Layout (`mobile/app/src/main/java/com/aams/student/`)
```
MainActivity.kt          entry / navigation router
ui/LoginActivity.kt      login (enforces role == "student")
ui/DashboardActivity.kt  welcome + scan button + registerDevice() + logout
ui/ScanActivity.kt       CameraX + ZXing QR scan → check-in
api/ApiClient.kt, AuthApi.kt, AttendanceApi.kt, ApiModels.kt
auth/SessionManager.kt
storage/SecureStorage.kt (EncryptedSharedPreferences)
attendance/CheckInRepository.kt
network/NetworkVerificationManager.kt, NetworkEvidence.kt, BssidNormalizer.kt
qr/QrScanAnalyzer.kt, QrPayloadParser.kt
```

### Permissions (manifest)
`CAMERA`, `ACCESS_WIFI_STATE`, `ACCESS_FINE_LOCATION` (maxSdk 32), `NEARBY_WIFI_DEVICES`.

### Implemented Capabilities
- Secure login (token → EncryptedSharedPreferences).
- Dashboard placeholder + device registration + logout.
- Camera QR scanning, payload parse (`AAMSQR1`), check-in POST + network evidence + `X-Mobile-Device` header.
- Response handling: 201 / 200 already / 403 network-mismatch / network-required.

### MISSING (student module, per target)
- Dashboard stats (overall %); subject-wise %; attendance history; timetable; today's classes; profile; semester/section display; **manual token entry** (only camera scan).

## Desktop Companion (Phase 7A) — root `desktop/`

PySide6 Python app, package `aams_companion`:
- `main.py`, `api.py`, `bssid.py`, `config.py`, `device.py`, `monitor.py`, `ui/main_window.py`, `ui/style.py`.
- `build.spec` + pre-built `dist/AAMS-Teacher-Companion/AAMS-Teacher-Companion.exe`.
- `desktop/tests/` — test_api.py, test_bssid.py, test_config_device.py, test_monitor.py.

This is the **teacher desktop client** that registers with `/api/companion/register/`, anchors a session to the classroom Wi-Fi (BSSID), and heartbeats `/api/companion/heartbeat/`. It is present and built; physical-device acceptance not re-verified in this audit.

## Teacher Mobile — MISSING

No teacher Android module exists. The single app requires student role. Offline + sync absent (see 12 and 13).
