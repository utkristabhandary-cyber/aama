# Phase 2 — Web-Only Modernization (Remove Obsolete Architecture)

Status: **COMPLETE** — obsolete mobile/desktop/companion architecture removed, attendance network verification simplified to web-only, and the full system re-validated (149 backend tests, lint, build, migrations) plus Demo Checkpoint 1 verified end-to-end through the UI.

---

## 1. Executive Summary

Phase 2 strips every non-web path out of AAMS so the product is a single,
coherent web application. Three artifacts of the abandoned
"mobile + desktop sync + companion attestation" architecture were removed and
the remaining system was re-verified:

- **`mobile/` (Android Student app)** — deleted entirely; there is no native
  student client anymore.
- **`desktop/` (WPF faculty desktop app)** — deleted entirely; all faculty work
  happens in the web SPA.
- **`backend/apps/companion/` (attestation + device registry service)** —
  deleted, including its inline BSSID-attestation model, device registry, bridge
  endpoints, and the offboarding migration that drops its tables from the live
  database.

Attendance evidence is now explicitly web-only: the only honest
`network_verification_method` is `unavailable` (browsers cannot OS-attest a
classroom BSSID), enforced at every layer — model choices, serializer help text,
back-end resolver, front-end copy, and docs. No insecure fabricated anchor is
fabricated: a web deployment can still *reject* unverified check-ins via the
existing `AAMS_QR_REQUIRE_NETWORK_VERIFICATION` gate.

During Demo Checkpoint 1 verification, three **pre-existing** integration bugs
(surviving from before Phase 2, none introduced by this phase) surfaced and were
fixed so the teacher/QR flows work against the live API:

1. `TeachingSessionSerializer.section_ids` was `write_only`, so the teacher
   dashboard crashed reading classes.
2. `apiClient.list()` assumed the DRF `{results: …}` paginated envelope for all
   endpoints, but the teacher `students`/`reports` custom actions return raw
   arrays → `undefined.map` crash.
3. `start_qr_session()` (attendance service) set `qr.attendance_session` in
   memory but `rotate()` persists only the token fields, so re-targeting a QR at
   a new attendance session was never committed to the database. Every student
   check-in silently flowed into the *seeded* session while the UI displayed the
   live one.

The QR roll-call demo (teacher LiveQR → two Section B students check in via the
web UI → roster marks PRESENT → replay blocked idempotently → teacher stops the
QR) is now verified end-to-end, with all records landing in the correct
attendance session.

---

## 2. Scope

**In scope (done):**

- Repository audit of every mobile / desktop / companion / network-attestation
  reference.
- Deletion of `mobile/`, `desktop/`, and `backend/apps/companion/` (code, config,
  templates, documentation).
- Application of the companion offboarding migration; creation and application of
  attendance migration `0003` dropping `bssid_normalized` and narrowing
  `network_verification_method` choices.
- Web-only attendance network verification end-to-end (backend resolver, model
  choices, serializer help text, QR payload copy, frontend scanner/LiveQR UI).
- Rewrite of `docs/00-SYSTEM-STATUS.md` to the web-only architecture.
- Full regression validation: 149 backend tests, `makemigrations --check`,
  `tsc --noEmit`, production build.
- Demo Checkpoint 1 (admin / teacher / student login + dashboards + QR
  roll-call) verified against the live API; three pre-existing integration bugs
  fixed as a result (see §9).

**Out of scope (explicitly deferred — not started):**

- Phase 3 auth & security hardening (separate work — already delivered and
  reported in `PHASE2_SECURITY_AUTH_REPORT.md` and
  `PHASE2B_AUTH_HARDENING_REPORT.md`).
- Any remaining product roadmap items outside web-only modernization
  (notifications redesign, backup/restore, promotion/import rewrite, etc.).

---

## 3. Repository Audit

| Path | Disposition |
|---|---|
| `mobile/` | Deleted (Android app — plugin, Gradle config, Kotlin/Java sources, strings) |
| `desktop/` | Deleted (WPF/.NET desktop app) |
| `backend/apps/companion/` | Deleted (Django app) |
| `backend/apps/attendance/migrations/0003_remove_attendancerecord_bssid_normalized.py` | Added + applied (drops `bssid_normalized`) |
| `docs/10-NETWORK-BSSID-VERIFICATION.md` | Rewritten: documents the web-only `unavailable` model; no native attestation claimed |
| `docs/11-MOBILE-DEVICE-REGISTRATION.md` | Rewritten: device registry concept removed |
| `docs/12-OFFLINE-ATTENDANCE.md` | Rewritten: offline sync removed |
| `docs/13-SYNCHRONIZATION.md` | Rewritten: mobile↔server sync removed |
| `docs/19-MOBILE-APP.md` | Rewritten: no mobile app |
| `docs/00-SYSTEM-STATUS.md` | Regenerated for the web-only architecture |
| `README.md` | Updated to web-only positioning |

Companion references in `backend/config/` (INSTALLED_APPS, URLs) were removed
with the app; its drop-table migration was applied to the live PostgreSQL
database before the app was deleted so database state and repository state stay
consistent. The seeded development database is verified intact
(`aams_db`, PostgreSQL 16).

---

## 4. Removed Architecture

**Mobile app (`mobile/`).** Gradle/Android project for a student attendance and
QR-scanning app with device registration against the companion service. Removed
in full — no native client exists anymore; students use the responsive web SPA.

**Desktop app (`desktop/`).** Windows presentation client for faculty. Removed
in full — teachers use the web SPA's Teaching Portal.

**Companion service (`backend/apps/companion/`).** The attestation backend that
owned:
- OS-attested BSSID capture (`CompanionDevice` / attestation models),
- a device registry and trust anchors,
- the `/api/companion/*` bridge endpoints,
- the offline check-in buffer.

Its tables were dropped by the offboarding migration during this phase; the app
directory no longer exists in the repository. Any residual companion
`network_verification_method` values or BSSID plumbing in the attendance app was
removed via migration `0003`.

---

## 5. Attendance & Network Verification Changes (web-only)

- `AttendanceRecord.network_verification_method` choices are now
  `[("unavailable", "Unavailable")]` with default `unavailable`; the
  `bssid_normalized` column is dropped (migration `0003`).
- `resolve_network_verification()` (attendance service) always returns
  `("unavailable", None)`; any client-claimed `method`/`bssid` is downgraded —
  a client can never mark itself network-verified.
- Check-in responses report `networkVerificationMethod: "unavailable"` and the
  frontend displays honest copy ("scans recorded without network attestation").
- The optional enforcement gate remains: `AAMS_QR_REQUIRE_NETWORK_VERIFICATION=true`
  rejects `unavailable` check-ins with HTTP 403
  `networkVerificationRequired`, so a stricter deployment is still possible.

---

## 6. Database Changes

| Migration | Purpose |
|---|---|
| `attendance.0002…bssid_normalized_and_more` (existing, kept) | Original BSSID + method field expansion |
| `attendance.0003_remove_attendancerecord_bssid_normalized` (new) | Drop `bssid_normalized`; narrow `network_verification_method` choices |
| companion drop migration (applied) | Drop companion tables; sequence positioned ahead of companion app deletion |

No applied migration was edited retroactively. `makemigrations --check
--dry-run` reports **No changes detected**.

---

## 7. Frontend Changes

- QR surfaces rewritten as web-only: `LiveQRPane` (teacher live display + 15s
  rotation + copyable payload) and `StudentQRScannerView` (camera/scanner page +
  manual code entry) show the web-only verification note and stop referencing
  any device/companion state.
- `src/types/api.ts` updated (network method type narrowed to `"unavailable"`).
- `src/services/apiClient.ts` `list()` now tolerates both the DRF paginated
  envelope (`{results, …}`) **and** raw arrays — required by the teacher
  `students`/`reports` custom actions (fix #2, §9).
- Services wired to the live API for auth, teacher classes/students, attendance
  sessions, QR start/check-in.

---

## 8. Documentation Changes

- `docs/00-SYSTEM-STATUS.md` — regenerated: web-only architecture, obsolete
  layers marked REMOVED, Phase 2 marked COMPLETED.
- BSSID / mobile-registration / offline / sync / mobile-app docs rewritten to
  state the web-only reality and remove claims about native attestation.
- This report.

---

## 9. Pre-existing Bugs Fixed During Demo Checkpoint 1

None of these are regression bugs; each predates Phase 2 and only surfaced when
the previously mock-heavy frontend started consuming the live API for the
checkpoint.

1. **Teacher dashboard crash — `section_ids` write-only.**
   `TeachingSessionSerializer.section_ids` was `write_only=True`, so GET
   responses omitted the field the frontend's `getTeacherClasses` needs. Fixed by
   removing `write_only` (the model already exposes a `section_ids` property;
   writes are unchanged). `backend/apps/academics/serializers.py`.

2. **Teacher roster crash — raw-array list responses.**
   `/api/teachers/students/` and `/api/teachers/reports/` return raw arrays, but
   `apiClient.list()` assumed `{results}`. Fixed by making `list()` unwrap the
   paginated envelope only when the response is not already an array.
   `src/services/apiClient.ts`.

3. **QR re-target never persisted.**
   `start_qr_session()` mutated `qr.attendance_session` (and reset the ledger)
   but `rotate()` saves only `["token", "token_generated_at"]`, so the FK change
   was never committed. The DB QR kept pointing at the seeded session while the
   UI/serializer showed the intended live session, so student check-ins were
   recorded against the wrong session. Fixed by persisting the re-target and
   ledger reset after rotation. `backend/apps/attendance/services.py` (see also
   §11). A regression test for the persisted re-target was added to
   `backend/apps/attendance/tests.py`.

---

## 10. Tests & Validation

| Check | Result |
|---|---|
| `py manage.py test` | **149 tests, OK** (accounts, academics, attendance, students, teachers, reports; no failures, 0 silenced) |
| `py manage.py makemigrations --check --dry-run` | **No changes detected** |
| `npm run lint` (`tsc --noEmit`) | Clean |
| `npm run build` | Success (6.1s; chunk-size advisory only) |
| Live DB migration state | Applied; `aams_db` seed data confirmed intact |

---

## 11. Demo Checkpoint 1 — Verified Flows

All flows verified against the running stack (Django API + Vite SPA) with the
seeded demo accounts (`AaMS@#2026!`).

**Admin**
- `admin` signs in to the admin portal and the dashboard/reports load without
  console errors.

**Teacher — tch-3 (Dr. R. Kumar, Computer Science)**
- Dashboard loads cleanly after fixes #1/#2: assigned classes (2), guard count,
  "My Teaching Allocations" with rosters (COMP1 × Sec A 3 students, × Sec B 2
  students). No new console errors.
- Take Attendance: Sec A (2026-09-09) correctly shows **Session Already
  Submitted** (its records are seeded/locked: 1 PRESENT / 1 ABSENT / 1 LATE).
- Live QR on Sec B session → live display shows rotating payload
  `AAMSQR1|6|<TOKEN>` (15s rotation), web-only note, and an initially unmarked
  roster.

**Student QR check-in**
- std-4 + std-5 (both Section B, both in session 6's roster) recorded via the
  web scanner UI ("**Roll Call Verified!**") and API; server reports
  `networkVerificationMethod: "unavailable"`.
- Teacher's roster for Sec B now reads **2 Total, 2 Present, 0 Absent, 0 Late**
  (Aditya Rao, Ishita Sen PRESENT) — markers appear live.

**Replay / duplicate protection**
- Re-submitting the same still-live code → HTTP 200
  `alreadyRecorded: true` ("Your attendance is already recorded…");
  no duplicate record.
- Submitting after the 15s rotation → HTTP 400 "Invalid or expired QR code".
- Records for the session are unique per (session, student): sessions 6 holds
  exactly `AttendanceRecord` id 7 (std-4) and id 8 (std-5), both present.

**Stop / revocation**
- `POST /api/attendance/qr/<id>/stop/` → 200 "QR session stopped"; QR row
  `revoked=true`; subsequent check-ins → 400 "This QR code is no longer
  active."; the "one active QR per teacher" constraint holds (a new QR row is
  created only after the previous one is revoked).

**Database truth check**
- `attendance_qrattendancesession.id=2` → `attendance_session=6`,
  `revoked=true`, `student_ids=[4,5]` — the re-target fix (#3) means what the DB
  stores matches what the UI displayed.

---

## 12. Remaining Issues / Known Limits

- Web-only check-ins carry no BSSID / OS attestation; `network_verification_method`
  is always `unavailable`. If institutional policy requires device-attested
  proof, a native client + attestation backend would need to be re-introduced
  (deliberately out of scope; the enforcement gate is in place).
- Frontend still has low-priority alerts (e.g. missing site favicon 404, a
  non-fatal QR scannability message on some devices) — cosmetic, no console
  error on the verified flows.
- Server processes for the demo run under scheduled tasks (`aams-backend`,
  `aams-vite`) with `--noreload`; process management for production is a
  deployment concern, not covered by Phase 2.

---

## 13. Next Phase

**Phase 3 — Auth & security hardening.** Already implemented and independently
reported (`PHASE2_SECURITY_AUTH_REPORT.md` = "Phase 2A",
`PHASE2B_AUTH_HARDENING_REPORT.md` = "Phase 2B"). Recommended next steps beyond
this phase's scope: notification redesign, backup/restore tooling, promotion &
import rewrite, and UI polish tracked in `docs/24-NEXT-PHASE-PLAN.md`.