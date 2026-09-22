# AAMS — Next Phase Plan (Web-Only Roadmap)

Documentation-only recommendation. Nothing here was implemented in this cleanup. Order is chosen to close the highest-impact gaps with the least rework.

AAMS Phase 2 made the system web-only; mobile, desktop companion, offline, and BSSID phases are retired and not part of this roadmap.

## Phase A — Stabilize & Deploy Config (Security-first)
1. Remove DB password from committed `.env` bare values; rely on git-ignored `.env` + `.env.example`. (High)
2. Force `DJANGO_DEBUG=false` + `DJANGO_SECRET_KEY` in any deploy; remove dev SECRET_KEY fallback. (Medium)
3. Serve over HTTPS and restrict `ALLOWED_HOSTS`/CORS origins to real domains. (Medium)
4. Reconsider web token storage (httpOnly cookie or shorter TTL) if feasible. (Medium)

## Phase B — Replace Frontend localStorage Mocks with Backend (Web correctness) — **COMPLETED (B.6-F + Phase G, Sep 2026)**

> Phase B is done. Items 5/6 (timetable admin, section allocation) are live; the
> combined mock→backend migration also covered global search, teacher students,
> profile branding, and settings. Items 7/9 (backend **Promotion** API, **Settings**
> API) remain **unimplemented backend gaps** — the UI now blocks/fakes nothing and
> shows read-only honest boundaries until they exist. See
> `PHASE_G_SOURCE_OF_TRUTH_REPORT.md`.

5. Wire **Timetable admin** CRUD to `/api/academics/timetable/` (keep backend conflict checks authoritative). — **DONE (B.5/B.6-F)**
6. Wire **Section allocation CSV** to student PATCH/PUT (`/api/students/{id}/`) so allocations persist. — **DONE (Phase G)**
7. Build **backend Promotion** API + archival migration (preserve historical attendance), then wire `PromotionView`.
8. *(Phase 8: notification read/mark-read/delete are backend-owned; the admin broadcast UI was intentionally removed — if broadcast is required later, build a real create endpoint + an admin-only compose surface. Do not reintroduce a fake local broadcast.)*
9. Implement **Settings** backend (or explicitly remove the shell screen).

## Phase C — Test Coverage & Release
10. Web-frontend test suite (Vitest/Playwright) covering the role matrix and re-wired admin flows.
11. Run a real end-to-end check-in scenario against a deployed build.
12. Release build verification (real API base URL, HTTPS).

## Explicitly Deferred / Non-Goals
- Full admin mobile portal, teacher-mobile, student Android app, desktop companion, offline/sync, BSSID/network verification (removed in Phase 2).

## Priority Ordering Rationale
Config/security (A) first because it's cheap and removes High findings. Web mock→backend (B) restores real persistence for core admin workflows. Test coverage/release (C) closes verification before any production deployment.