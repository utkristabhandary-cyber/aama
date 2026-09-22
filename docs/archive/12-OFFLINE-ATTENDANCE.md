# AAMS — Offline Teacher Attendance

## Status: MISSING

## Section-4 Requirement (target state)

Teacher mobile must support recording attendance with **no internet**, storing marks in a **local pending queue**, and **automatically synchronizing** to the server when connectivity returns — with sync status visible to the teacher.

## Current Reality

**No offline teacher attendance exists.** Verified strictly:

| Requirement | Exists? |
|-------------|---------|
| Teacher mobile app    | MISSING (no teacher Android app at all) |
| Local offline storage (Room/SQLite) | MISSING |
| Offline pending queue   | MISSING |
| Client-side sync engine / worker | MISSING |
| Server sync endpoint(s) | MISSING |
| Sync status/history UI  | MISSING |
| Conflict rules (idempotency, timestamps, session validation) | MISSING |

## Evidence

- The single mobile app rejects non-student logins; there is no teacher module or offline capability.
- No Room dependency, no SyncManager, no local queue, no WorkManager/worker class in `mobile/`.
- The Android app requires the campus network for everything (it hits the backend directly through OkHttp for login and check-in).
- Backend has no batch "offline sync" endpoint; attendance creation is real-time and transaction-bound.
- No integration tests for offline flows.

## Implication

This is a **design-time/future** feature. It is a first-class gap, not a bug. See `23-IMPLEMENTATION-GAPS.md` and `24-NEXT-PHASE-PLAN.md` for where it lands in the roadmap.

## Minimum Future Design (for planning only — NOT implemented)

1. Teacher mobile module in the existing single app (role-gated) with "Today's classes."
2. Local SQLite/Room store mirroring (session_id → student marks) with original timestamps.
3. Offline toggle → queue writes locally.
4. On reconnect → Worker syncs queue, server validates session/student/enrollment, idempotent via request id, then marks synced.
5. Sync status/history screen + badge.
