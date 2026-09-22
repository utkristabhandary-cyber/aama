# AAMS — Phase 2.5 Cleanup Review

> **SUPERSEDED in part by Phase G (19 Sep 2026):** the `src/data/initialData.ts` +
> `src/services/storage.ts` mock fallback layer this review decided to KEEP was
> **deleted** in Phase G along with `academicRules.ts` and `promotionService.ts`.
> Every screen is now server-backed or honestly read-only. See
> `PHASE_G_SOURCE_OF_TRUTH_REPORT.md`.

Documentation-only cleanup performed 9 Sep 2026. This cleanup removed stale historical
artifacts, dead code, and generated debris; no runtime behavior changed. The codebase is
authoritative and the docs set now reflects it.

## Files deleted

- `dist/` — stale frontend build output (regenerable via `npm run build`; git-ignored).
- All backend `__pycache__/` trees — stale bytecode. Several orphaned `.pyc` had no source
  (`tests.cpython-313.pyc`, `tests_scratch*.pyc`, `identity_tests.pyc`): pure artifacts.
- `public/` — contained only `public/assets/aistudio/.gitignore` (2 bytes), an AI Studio
  scaffold remnant of no value.

## Files moved to `docs/archive/` (preserved for reference, no longer authoritative)

- Phase reports: `PHASE1_IMPLEMENTATION_REPORT.md`, `PHASE2_SECURITY_AUTH_REPORT.md`,
  `PHASE2B_AUTH_HARDENING_REPORT.md`, `PHASE2_WEBONLY_REPORT.md`,
  `PHASE3_API_INTEGRATION_REPORT.md`, `PHASE4_AUTH_IDENTITY_OPERATIONAL_INTEGRATION_REPORT.md`,
  `PHASE5_ATTENDANCE_SESSION_ENGINE_REPORT.md`, `PHASE6_QR_BSSID_SECURITY_REPORT.md`,
  `PHASE7A_TEACHER_DESKTOP_BSSID_REPORT.md`, `PHASE7B_STUDENT_ANDROID_BSSID_REPORT.md`.
- Audit reports: `AAMS_AUDIT_REPORT.md`, `AAMS_FRONTEND_BACKEND_INTEGRATION_AUDIT.md`.
- Removed-architecture docs: `10-NETWORK-BSSID-VERIFICATION.md`, `11-MOBILE-DEVICE-REGISTRATION.md`,
  `12-OFFLINE-ATTENDANCE.md`, `13-SYNCHRONIZATION.md`, `19-MOBILE-APP.md` (numbered as-documented
  under the old scheme; the current `10-..` and `11-..` slots are timetable/calendar and reports).
- `metadata.json` — AI Studio scaffold metadata (contained `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`,
  which the rebuilt app no longer uses).

## Documentation rewritten for web-only reality

`docs/README.md` (index + project layout), `00-SYSTEM-STATUS.md` (spot-check — already web-only),
`01-ARCHITECTURE.md`, `02-REQUIREMENTS.md`, `03-AUTHENTICATION-RBAC.md`, `05-STUDENT-MODULE.md`,
`06-TEACHER-MODULE.md`, `07-ADMIN-MODULE.md` (removed stale Android-app sentence),
`08-ATTENDANCE-SYSTEM.md`, `09-QR-ATTENDANCE.md`, `16-DATABASE.md`, `17-API-REFERENCE.md`,
`20-SECURITY-AUDIT.md`, `21-TESTING.md`, `22-KNOWN-ISSUES.md`, `23-IMPLEMENTATION-GAPS.md`,
`24-NEXT-PHASE-PLAN.md`, `AUDIT-MATRIX.md`. The audit matrix dropped retired
companion/offline/mobile rows (28→32 rows).

## Frontend dependency cleanup (`package.json`)

- `name`: `react-example` → `aams-web`.
- Removed `dependencies`: `@google/genai`, `dotenv`, `express`, `motion` (all unused).
- Removed `devDependencies`: `@types/express`, `tsx` (unused).
- Kept: `qrcode` + `jsqr` (used by `LiveQRPane` / `StudentQRScannerView`); `esbuild` (dev only).
- `npm install --no-audit --no-fund` executed: 132 packages pruned; `package-lock.json` synced.

## Root README

Replaced AI Studio scaffold boilerplate (`# Run and deploy your AI Studio app`) with a
project README: quick start for backend + frontend, layout, docs pointer, and caveats.

## UNCERTAIN / left as-is (decision needed later)

| Item | Status | Note |
|------|--------|------|
| `bun.lock` | KEPT | npm (with `package-lock.json`) is the active package manager; bun lockfile is stale byproduct. Safe to delete once team confirms no bun usage. |
| `esbuild` lifecycle warning | RESOLVED | `npm install` warns esbuild postinstall is not covered by `allow-scripts`; `npm run build` confirmed working (verification below), so it is informational only. |
| `vite.config.ts` AI Studio comments | KEPT | Cosmetic only; build config is correct. |
| Root `clean` script `rm -rf dist server.js` | KEPT | `server.js` has never existed; script order/safety unchanged. |
| `src/data/initialData.ts` + `src/services/storage.ts` | KEPT | Mock fallback layer is wired into many services; removing it would change runtime behavior. Track for Phase B (mock→backend). |
| Historical migrations `0002_attendancerecord_bssid_normalized` / `0003_remove_...` | KEPT | Correct historical record of the Phase 2 column add/drop; do not edit. |
| `.gitignore` | VERIFIED | `node_modules/ build/ dist/ coverage/ .DS_Store *.log .env* !env.example`; covers all generated assets incl. `dist/` and `.env`. |
| Duplicate `vite` in deps + devDeps | KEPT | Pre-existing; harmless (root dep version used at runtime). |

## Behavior-change check

- No backend API, model, migration, permission, or service logic was modified.
- No frontend runtime module was modified; only `package.json` metadata deps were removed.
- Demo servers (`aams-backend` :8000, `aams-vite` :3000) were not restarted during cleanup.
## Final validation (9 Sep 2026)

- `py manage.py test` — **149 tests OK** (210s).
- `py manage.py makemigrations --check --dry-run` — **No changes detected**.
- `npm run lint` (`tsc --noEmit`) — **clean**. `npm run build` (vite+esbuild) — **build OK** (1801 modules; chunk-size warning only).
- Demo servers healthy post-cleanup: backend `/api/health/` 200 (DB connected), Vite 3000 200.