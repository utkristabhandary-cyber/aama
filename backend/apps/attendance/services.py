from django.db import transaction
from django.utils import timezone

from apps.academics.models import SemesterStatus
from apps.attendance.models import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    QRAttendanceSession,
    generate_token,
)
from apps.students.models import Student


def start_qr_session(teacher, attendance_session) -> QRAttendanceSession:
    """Return (creating if needed) the single active QR session for a teacher.

    One active QR session per teacher is enforced by a partial unique constraint;
    the existing token is rotated so a fresh payload is displayed. When the QR is
    re-targeted at a DIFFERENT attendance session, its per-student ledger is
    reset so stale check-in data can never leak across classrooms.
    """
    with transaction.atomic():
        qr, created = QRAttendanceSession.objects.get_or_create(
            teacher=teacher,
            revoked=False,
            defaults={"attendance_session": attendance_session, "token": generate_token()},
        )
        if not created:
            if qr.attendance_session_id != attendance_session.pk:
                qr.student_ids = []
                qr.student_timestamps = {}
        qr.attendance_session = attendance_session
        qr.rotate()
        # rotate() persists only the token fields; persist the re-target and any
        # ledger reset so the DB always matches what the serializer reports.
        qr.save(update_fields=["attendance_session", "student_ids", "student_timestamps"])
    return qr


def stop_qr_session(qr_session: QRAttendanceSession) -> None:
    qr_session.revoked = True
    qr_session.save(update_fields=["revoked"])


def build_qr_payload(qr_session: QRAttendanceSession) -> str:
    token = qr_session.get_current_token()
    return f"AAMSQR1|{qr_session.attendance_session_id}|{token}"


def validate_qr(qr_session_id, token_entered):
    """Validate a student-submitted QR token.

    Mirrors the frontend ``validateQR`` flow: the code must match the live token of an
    active QR session and the code must not already have been used for this student.
    Returns a ``(valid, message, payload)`` triple.
    """
    qr = QRAttendanceSession.objects.filter(id=qr_session_id).first()
    if qr is None or qr.revoked:
        return False, "QR session is no longer active.", None
    if qr.attendance_session.is_finalized:
        return False, "Attendance has already been submitted.", None
    current = qr.get_current_token()
    if token_entered is None or token_entered.strip().upper() != current.strip().upper():
        return False, "Invalid or expired code. Please try again.", None
    payload = {
        "attendanceSessionId": qr.attendance_session_id,
        "teachingSessionId": (
            qr.attendance_session.teaching_session_id
            if qr.attendance_session.teaching_session_id
            else None
        ),
        "subjectName": qr.attendance_session.subject.name,
        "teacherName": qr.attendance_session.teacher.name,
        "phase": qr.attendance_session.phase,
    }
    return True, "QR code accepted.", payload


def mark_qr_student(attendance_session, student, status="present"):
    """Idempotently mark a student: one 'Present' row per session, else 'Late'/'Absent'."""
    attendance_ids = list(attendance_session.attendance_ids or [])
    if student.pk not in attendance_ids:
        attendance_ids.append(student.pk)
        attendance_session.attendance_ids = attendance_ids
        attendance_session.save(update_fields=["attendance_ids"])
    record, created = AttendanceRecord.objects.get_or_create(
        attendance_session=attendance_session,
        student=student,
        defaults={"status": status, "marking_complete": True},
    )
    if not created and record.status != status:
        record.status = status
        record.save(update_fields=["status"])
    return record


def mark_qr_student_via_code(qr_session: QRAttendanceSession, student: Student):
    """Server-authorized QR check-in for an authenticated student.

    The rolling token is shared (never consumed per student), so replay is
    prevented per student: one mark per (student, attendance session). The
    student identity always comes from ``request.user.student_profile`` — never
    from client-supplied input. Returns ``(ok, message, record)``.
    """
    attendance_session = qr_session.attendance_session
    if qr_session.revoked:
        return False, "QR session is no longer active.", None
    if attendance_session.is_finalized:
        return False, "Attendance has already been submitted.", None
    section_ids = set(
        attendance_session.sections.values_list("id", flat=True)
    )
    if student.section_id not in section_ids:
        return False, "You are not part of this class section.", None
    if AttendanceRecord.objects.filter(
        attendance_session=attendance_session, student=student
    ).exists():
        return False, "Your attendance is already recorded for this session.", None
    with transaction.atomic():
        record = mark_qr_student(
            attendance_session, student, AttendanceStatus.PRESENT.value
        )
        student_ids = list(qr_session.student_ids or [])
        if student.pk not in student_ids:
            student_ids.append(student.pk)
        timestamps = dict(qr_session.student_timestamps or {})
        timestamps[str(student.pk)] = timezone.now().isoformat()
        qr_session.student_ids = student_ids
        qr_session.student_timestamps = timestamps
        qr_session.save(update_fields=["student_ids", "student_timestamps"])
    return True, "Attendance recorded.", record


NETWORK_METHODS = {"unavailable"}

QR_PAYLOAD_PREFIX = "AAMSQR1"


def parse_qr_payload(payload):
    """Split a ``AAMSQR1|<attendance_session_id>|<TOKEN>`` payload.

    Returns ``(ok, message, qr_session_id, token)``. The token string is
    returned only for comparison — no further client data is ever trusted.
    """
    if not isinstance(payload, str) or not payload:
        return False, "Invalid QR code format.", None, None
    parts = payload.split("|")
    if (
        len(parts) != 3
        or parts[0] != QR_PAYLOAD_PREFIX
        or not parts[1].isdigit()
    ):
        return False, "Invalid QR code format.", None, None
    token = parts[2].strip()
    if not token:
        return False, "Invalid QR code format.", None, None
    return True, "", int(parts[1]), token


def resolve_network_verification(network, attested=False):
    """Resolve the honest network-verification evidence a check-in may carry.

    This application is web-only: a browser cannot attest a classroom BSSID and
    there is no companion/device registry, so the honest report is always
    ``("unavailable", None)``. Any client-claimed ``bssid`` /
    ``mobile_network_bridge`` method is downgraded to ``unavailable`` — a client
    can never mark itself network-verified on its own.
    """
    if not isinstance(network, dict):
        network = {}
    method = network.get("method") or "unavailable"
    if method not in NETWORK_METHODS:
        raise ValueError("Unsupported network verification method.")
    return method, None


def check_in_student(token_entered, student, network=None):
    """Server-authoritative QR check-in.

    The student identity ALWAYS comes from ``request.user.student_profile``
    (passed in as ``student``); nothing in the payload is trusted as identity.
    The attendance-session id is extracted from the ``AAMSQR1|id|TOKEN``
    payload itself. Returns ``(http_status, response_dict)``.

    This application is web-only, so ``resolve_network_verification`` always
    reports ``unavailable`` for the recorded evidence; there is no companion
    device registry, no OS-attested BSSID, and no teacher network anchor.

    Validation order is deliberate so a wrong/missing token can never confirm
    or deny anything specific about an attendance session:

    1. payload format            -> 400 generic
    2. QR session exists + live  -> 400 generic
    3. attendance not finalized  -> 400 generic
    4. semester not completed    -> 400 generic
    5. token is current (const. time) -> 400 generic
    6. section membership        -> 403 (eligibility, no validity leak)
    7. network policy gate       -> 403 ``networkVerificationRequired``
    8. duplicate / replay        -> 200 ``alreadyRecorded`` (idempotent)
    9. create AttendanceRecord  -> 201
    """
    from django.conf import settings

    ok, message, qr_session_id, token = parse_qr_payload(token_entered)
    if not ok:
        return 400, {"detail": message}

    # The payload embeds the *attendance_session* id (AAMSQR1|<session id>|TOKEN),
    # not the QR row id. Resolve the single active QR for that attendance session:
    # a teacher holds at most one active QR at a time, and an attendance session
    # belongs to exactly one teacher, so the lookup is unambiguous.
    qr = QRAttendanceSession.objects.filter(
        attendance_session_id=qr_session_id, revoked=False
    ).first()
    if qr is None:
        return 400, {"detail": "This QR code is no longer active."}
    attendance_session = qr.attendance_session
    if attendance_session.is_finalized:
        return 400, {"detail": "Attendance has already been submitted for this class."}
    if attendance_session.subject.semester.status == SemesterStatus.COMPLETED:
        return 400, {"detail": "Classes for this semester have ended."}

    if not token_is_current(qr, token):
        return 400, {"detail": "Invalid or expired QR code. Ask your teacher for a fresh code."}

    section_ids = set(attendance_session.sections.values_list("id", flat=True))
    if student.section_id not in section_ids:
        return 403, {"detail": "You are not part of this class section."}

    try:
        method, bssid = resolve_network_verification(network)
    except ValueError as exc:
        return 400, {"detail": str(exc)}

    if (
        getattr(settings, "AAMS_QR_REQUIRE_NETWORK_VERIFICATION", False)
        and method == "unavailable"
    ):
        return 403, {
            "detail": (
                "This class requires network-verified check-in, which the web "
                "browser cannot provide."
            ),
            "networkVerificationRequired": True,
        }

    existing = AttendanceRecord.objects.filter(
        attendance_session=attendance_session, student=student
    ).first()
    if existing is not None:
        return 200, {
            "detail": "Your attendance is already recorded for this session.",
            "alreadyRecorded": True,
            "status": existing.status,
            "attendance": _record_payload(existing),
        }

    with transaction.atomic():
        record = mark_qr_student(
            attendance_session, student, AttendanceStatus.PRESENT.value
        )
        record.checked_in_at = timezone.now()
        record.network_verification_method = method
        record.save(
            update_fields=[
                "checked_in_at",
                "network_verification_method",
            ]
        )
        student_ids = list(qr.student_ids or [])
        if student.pk not in student_ids:
            student_ids.append(student.pk)
        timestamps = dict(qr.student_timestamps or {})
        timestamps[str(student.pk)] = timezone.now().isoformat()
        qr.student_ids = student_ids
        qr.student_timestamps = timestamps
        qr.save(update_fields=["student_ids", "student_timestamps"])
    return 201, {
        "detail": "Attendance recorded.",
        "alreadyRecorded": False,
        "status": record.status,
        "networkVerificationMethod": method,
        "attendance": _record_payload(record),
    }


def _record_payload(record) -> dict:
    return {
        "id": record.pk,
        "studentId": record.student_id,
        "status": record.status,
        "checkedInAt": record.checked_in_at.isoformat() if record.checked_in_at else None,
        "networkVerificationMethod": record.network_verification_method,
    }


def token_is_current(qr_session: QRAttendanceSession, token_entered) -> bool:
    """Constant-time comparison of a submitted token against the live token."""
    current = qr_session.get_current_token()
    if token_entered is None:
        return False
    from secrets import compare_digest

    return compare_digest(
        token_entered.strip().upper(), current.strip().upper()
    )


def finalize_attendance_session(attendance_session, marked_ids=None, late_reason=""):
    """Submit an attendance session.

    Unmarked students deliberately have NO record row (they remain UNMARKED) — the
    frontend amount to 'false' and is never auto-Present.
    """
    with transaction.atomic():
        attendance_session.marked_ids = list(marked_ids or attendance_session.marked_ids or [])
        attendance_session.late_reason = late_reason
        attendance_session.end_time = attendance_session.end_time or timezone.now().time()
        attendance_session.submitted_at = timezone.now()
        attendance_session.save(
            update_fields=[
                "marked_ids",
                "late_reason",
                "end_time",
                "submitted_at",
            ]
        )
    return attendance_session


def find_duplicate_session(teacher, subject_id, session_date, section_ids, exclude_id=None):
    """Return an existing attendance session that would be a duplicate.

    A duplicate is any session already created by the same teacher for the same
    subject on the same date whose section set overlaps the requested one. This
    is the server-side version of the frontend's old "already recorded for this
    exact slot and date" guard: a class cannot be recorded twice.
    """
    sessions = AttendanceSession.objects.filter(
        teacher=teacher, subject_id=subject_id, session_date=session_date
    )
    if exclude_id is not None:
        sessions = sessions.exclude(pk=exclude_id)
    requested = set(section_ids or [])
    for session in sessions.select_related("subject"):
        overlapping = requested & set(
            session.sections.values_list("id", flat=True)
        )
        if overlapping:
            return session
    return None


def roll_call_for_session(attendance_session, statuses=None) -> dict:
    """Return the full roll for a session: present/absent/late rows plus UNMARKED ids."""
    statuses = statuses or {}
    records = {
        r.student_id: r
        for r in AttendanceRecord.objects.filter(attendance_session=attendance_session)
    }
    roll = []
    for student in (
        Student.objects.filter(section_id__in=attendance_session.sections.values("id"))
        .select_related("section")
        .order_by("roll_no")
    ):
        record = records.get(student.pk)
        status = record.status if record else None
        if status is None and str(student.pk) in statuses:
            status = statuses[str(student.pk)]
        roll.append(
            {
                "studentId": student.pk,
                "studentCode": student.student_id,
                "studentName": student.name,
                "rollNo": student.roll_no,
                "sectionId": student.section_id,
                "sectionName": student.section.name if student.section else None,
                "status": status,
                "marked": record is not None,
            }
        )
    return {"attendanceSessionId": attendance_session.pk, "students": roll}


STATUS_PRESENT = ({AttendanceStatus.PRESENT.value, AttendanceStatus.LATE.value})


def summarize_student_attendance(student, semester=None, subject=None) -> dict:
    """Aggregate a student's own attendance records into a per-subject summary.

    Present counts both ``present`` and ``late`` marks (a late student did show
    up). Unmarked classes simply have no record and are excluded from totals.
    The result is the authoritative payload for ``GET /attendance/records/my/``.
    """
    records = AttendanceRecord.objects.filter(
        student=student
    ).select_related(
        "attendance_session__subject",
        "attendance_session__teacher",
    )
    if semester is not None:
        records = records.filter(
            attendance_session__sections__semester_id=semester.pk
        ).distinct()
    if subject is not None:
        records = records.filter(attendance_session__subject_id=subject.pk)

    present_total = 0
    absent_total = 0
    late_total = 0
    total = 0
    grouped = {}
    logs = []
    for record in records.iterator():
        session = record.attendance_session
        status = record.status
        total += 1
        if status in STATUS_PRESENT:
            present_total += 1
        elif status == AttendanceStatus.ABSENT.value:
            absent_total += 1
        if status == AttendanceStatus.LATE.value:
            late_total += 1
        subject_id = session.subject_id
        bucket = grouped.setdefault(
            subject_id,
            {
                "subjectId": subject_id,
                "subjectCode": session.subject.code,
                "subjectName": session.subject.name,
                "present": 0,
                "absent": 0,
                "late": 0,
                "total": 0,
                "percentage": 0.0,
            },
        )
        bucket["total"] += 1
        if status in STATUS_PRESENT:
            bucket["present"] += 1
        elif status == AttendanceStatus.ABSENT.value:
            bucket["absent"] += 1
        if status == AttendanceStatus.LATE.value:
            bucket["late"] += 1
        logs.append(
            {
                "attendanceSessionId": session.pk,
                "sessionDate": session.session_date.isoformat(),
                "startTime": session.start_time.isoformat() if session.start_time else None,
                "endTime": session.end_time.isoformat() if session.end_time else None,
                "classType": session.phase,
                "subjectId": subject_id,
                "subjectCode": session.subject.code,
                "subjectName": session.subject.name,
                "teacherName": session.teacher.name,
                "status": status,
                "notes": getattr(session, "late_reason", ""),
            }
        )

    for bucket in grouped.values():
        bucket["percentage"] = (
            round((bucket["present"] / bucket["total"]) * 100, 2)
            if bucket["total"]
            else 0.0
        )

    subjects = sorted(grouped.values(), key=lambda b: b["subjectCode"])
    logs.sort(key=lambda l: (l["sessionDate"], l.get("startTime") or ""), reverse=True)

    overall_percentage = round((present_total / total) * 100, 2) if total else 0.0

    return {
        "student": {
            "id": student.pk,
            "student_id": student.student_id,
            "name": student.name,
            "roll_no": student.roll_no,
        },
        "overallPercentage": overall_percentage,
        "overallPresent": present_total,
        "overallTotal": total,
        "overallAbsent": absent_total,
        "overallLate": late_total,
        "totalClasses": total,
        "totalPresent": present_total,
        "totalAbsent": absent_total,
        "totalLate": late_total,
        "examEligibility": "eligible" if overall_percentage >= 75.0 else "shortage",
        "subjects": subjects,
        "logs": logs,
    }