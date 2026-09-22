# AAMS — Requirements (Web-Only)

This document records the requirements of the **current** AAMS system. AAMS is a
**web-only** system; it has no mobile app, no desktop companion, no offline capability,
and no network/BSSID verification (those were removed in Phase 2 because browsers cannot
OS-attest a classroom network). Everything below is implemented or an explicit
out-of-scope item — nothing is a `[TARGET]` for a mobile/companion architecture.

## 1. Purpose

AAMS is a web application for managing class attendance in an academic institution:

- Admins manage semesters, sections, subjects, teachers, students, assignments, timetable.
- Teachers record attendance (manual and QR) for their own sessions.
- Students view their own attendance and mark attendance via QR / token codes.

## 2. Roles

| Role | Primary surface | Capabilities |
|------|-----------------|--------------|
| **Admin** | Web | Full configuration, promotion, reports, notifications, settings |
| **Teacher** | Web | Sessions, manual/QR attendance, reports, own timetable |
| **Student** | Web | View own attendance, QR/token check-in, timetable, history, profile |

## 3. Functional Requirements by Module

### 3.1 Authentication & Authorization
- Username-based login (student ID / staff code / admin handle).
- Role-based access control enforced server-side.
- Expiring tokens.

### 3.2 Academic Structure
- Semesters (name, code, academic year, dates, status).
- Sections within semesters (capacity, room).
- Subjects within semesters (code, name, credits, type Lecture/Tutorial/Practical).
- Teachers; Students (with section, semester, demographics, guardian).
- Teacher→Subject→Section assignments; rule: one module per teacher per semester.

### 3.3 Timetable & Calendar
- Weekly timetable slots (day, start/end, room, combined sections, teacher, subject).
- Teaching sessions (recurring blocks).
- Holiday / academic calendar.

### 3.4 Attendance
- Attendance sessions (phase manual/qr; sections; subject; teacher).
- Attendance records (stat present/absent/late; marking flags; submitted_at).
- Roll call; bulk marking; finalize (immutable).
- Duplicate-session prevention.
- QR check-in with rolling, rotated token (TTL default 15s) and constant-time validation.
- Token (manual) check-in.
- Idempotent, replay-resistant check-ins per student.

### 3.5 Reporting & Analytics
- Summary (sessions, marked, present/late/absent, %, at-risk students).
- By-subject breakdown.
- Teacher per-class reports.
- Student own-attendance summary (overall + per-subject + logs + exam eligibility).

### 3.6 Notifications
- Per-user notifications; read/unread; mark-read / mark-all-read.

### 3.7 Promotion
- Promote student cohorts between semesters while preserving historical attendance.

## 4. Non-Functional Requirements

- Attendance check-ins must be idempotent and replay-resistant per student.
- QR tokens short-lived (TTL, default 15s) and rotated.
- Rate limiting on login and QR hot paths.
- PostgreSQL backend.
- Server-side network evidence is always `unavailable`; client-claimed `bssid` /
  `mobile_network_bridge` evidence is rejected (no OS attestation exists on the web).

## 5. Removed Scope (Phase 2)

Deliberately removed in Phase 2 (web-only modernization) — NOT items to be re-added:

- Android (Kotlin) student app; teacher mobile app.
- Desktop companion (Phase 7A) and student mobile BSSID capture (Phase 7B).
- Device registry / registration endpoints.
- Offline teacher attendance queue and synchronization.
- Network/BSSID verification methods (`bssid`, `mobile_network_bridge`,
  `teacher_anchor_verified`); the `bssid_normalized` column was dropped.