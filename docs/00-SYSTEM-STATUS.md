# AAMS System Status

Regenerated: 19 September 2026 (from repository source, post Phase H — institutional data import/export)

## Overall System Health

| Component | Status | Evidence |
|-----------|--------|----------|
| Django Backend | IMPLEMENTED | 9 Django apps, mature DRF viewset structure, comprehensive tests (409 passing) |
| PostgreSQL DB | IMPLEMENTED | Models + migrations across all apps; psycopg2 configured |
| Web Frontend (Vite+React) | IMPLEMENTED | Role-based SPA, API-wired everywhere; localStorage mock store removed (Phase G); 75 Vitest tests |
| Institutional Data Import/Export | IMPLEMENTED (Phase H) | Server-backed analyze → stage → confirm pipelines + template/export downloads for Students, Teachers, Timetable (see `25-INSTITUTIONAL-DATA-IMPORT.md`) |
| Android Mobile (Student) | REMOVED (Phase 2) | `mobile/` deleted; app is web-only |
| Teacher Desktop Companion (Phase 7A) | REMOVED (Phase 2) | `desktop/` and `backend/apps/companion/` deleted; companion tables dropped |
| Phase 7B (Student Mobile BSSID) | REMOVED (Phase 2) | Backend network+attestation logic removed; `bssid_normalized` column dropped |

## Architecture (post Phase 2)

- **Web-only.** There is no Android client, no desktop companion, no companion API,
  and no device registry. Browsers cannot provide an OS-attested BSSID.
- Network verification is honestly reported as `unavailable` for every check-in;
  the backend records `network_verification_method = "unavailable"` and rejects any
  client-claimed `bssid` / `mobile_network_bridge` method as unsupported.
- **QR code is the primary attendance mechanism**: `AAMSQR1|<session id>|<TOKEN>`,
  ~15s token TTL, server-side rotation, constant-time compare, one active QR per
  teacher, idempotent check-in, throttling, and replay prevention.
- `AAMS_QR_REQUIRE_NETWORK_VERIFICATION` remains a setting (default `false`) so a
  web-only deployment can still opt into rejecting unverified web check-ins.
  `AAMS_TRUST_OS_ATTESTED_NETWORK` was removed (no native clients exist).

## Phase-By-Phase Status

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Core academia + frontend | IMPLEMENTED |
| 2 (web-only) | Remove obsolete mobile/desktop/companion architecture | COMPLETED |
| 2 / 2B | Auth & security hardening | IMPLEMENTED (Phase 3 of web-only plan — see `24-NEXT-PHASE-PLAN.md`) |
| 3 | API integration | IMPLEMENTED |
| 4 | Identity/operational integration | IMPLEMENTED |
| 5 | Attendance session engine | IMPLEMENTED |
| 6 | QR security | IMPLEMENTED |
| 7A | Teacher desktop BSSID anchor | RETIRED (Phase 2 — removed) |
| 7B | Student Android BSSID | RETIRED (Phase 2 — removed) |
| G | Full frontend source-of-truth audit — delete localStorage mock store, wire every screen to live DRF data, honest read-only boundaries, regression tests, browser E2E | COMPLETED (see `PHASE_G_SOURCE_OF_TRUTH_REPORT.md`) |
| H | Institutional data import & export — server-backed student/teacher/timetable analyze → stage → confirm pipelines, template + export downloads, admin wizard integration | COMPLETED (see `PHASE_H_REPORT.md`) |

## Big-Picture Path Forward (executive summary)

1. **Phase 3 (security hardening)** is next: `.env` credential rotation, DEBUG /
   SECRET_KEY / CORS tightening, and token-storage changes in the web client.
2. ~~**Frontend mock migration** remains open — a few frontend services still use
   legacy in-browser mock storage instead of the backend.~~ **COMPLETED (Phase G).**
   The localStorage mock store (`storage.ts`, `initialData.ts`, `academicRules.ts`,
   `promotionService.ts`) was deleted; every screen is now server-backed or honestly
   read-only. Frontend test suite: 75 Vitest tests; backend: 409 tests.
3. **Institutional data import/export (Phase H) is complete and server-backed** —
   uploads only stage a plan; only the confirmed atomic step writes. Template and
   export downloads are generated server-side (openpyxl `.xlsx`) and admin-only.
3. No physical-device acceptance tests are needed anymore: mobile/desktop paths
   are removed.

## Status Flags That Need Physical Confirmation

- None. All previous Phase 7A/7B physical-acceptance items were retired with the
  removed architecture.