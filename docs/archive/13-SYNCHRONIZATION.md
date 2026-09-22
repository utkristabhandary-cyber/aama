# AAMS — Synchronization

## Status: MISSING (offline teacher sync); PARTIAL elsewhere (see below)

## Target-State Requirement

Automatic synchronization of the teacher-mobile offline attendance queue when connectivity returns. Sync status/history surfaced to the teacher.

## Current Reality

**No offline sync mechanism exists.** There is:

- No offline queue to sync (see `12-OFFLINE-ATTENDANCE.md`).
- No client sync worker.
- No server-side batch/offline-sync endpoint.

## What DOES "sync" today (if anything)?

- The web app is a live API client (no offline sync).
- The mobile app is a live API client (login + check-in are synchronous HTTP).
- Real-time presence/heartbeat (companion) is live, not queued.
- No pull-to-refresh delta cache, no offline-first reads, no device-level delta ledger.

## Implication

Synchronization is **entirely future work**. It depends on first building offline teacher attendance. Sequencing is captured in `24-NEXT-PHASE-PLAN.md`.

## Design Notes (planning only, not implemented)

- Sync must be **conflict-safe**: same session, same student, one authoritative `AttendanceRecord` (unique constraint already exists) → natural idempotency with retry + request ids.
- Timestamps must originate on-device (offline) but be validated server-side (session open, student enrolled, submission order).
- Sessions marked offline must still finalize server-side once synced; finalize-on-sync semantics to be defined.
- Sync status persisted locally and shown as per-session/global badge.
