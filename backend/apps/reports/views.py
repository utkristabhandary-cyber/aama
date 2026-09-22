from django.db.models import Count, Q
from django.utils import timezone

from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.academics.models import Section, Semester, SemesterStatus, Subject
from apps.accounts.permissions import IsAdminOrTeacher, IsAdminUser
from apps.attendance.models import AttendanceRecord, AttendanceSession, AttendanceStatus
from apps.students.models import Student
from apps.teachers.models import Teacher


def pct(present, total):
    return round((present / total) * 100, 1) if total else 0.0


def _scope_sessions(request, semester_id=None):
    """Attendance sessions the requester may report on.

    Admins see institution-wide sessions; teachers only see their own.
    """
    sessions = AttendanceSession.objects.all()
    if semester_id:
        sessions = sessions.filter(subject__semester_id=semester_id)
    if request.user.role == "teacher":
        teacher = getattr(request.user, "teacher_profile", None)
        if teacher is None:
            return sessions.none()
        sessions = sessions.filter(teacher=teacher)
    return sessions.distinct()


def _scoped_total_students(request, sessions, semester_id=None):
    if request.user.role == "admin":
        if semester_id:
            return Student.objects.filter(section__semester_id=semester_id).count()
        return Student.objects.count()
    section_ids = sessions.values_list("sections__id", flat=True).distinct()
    return Student.objects.filter(section_id__in=section_ids).count()


@api_view(["GET"])
@permission_classes([IsAdminOrTeacher])
def summary(request):
    semester_id = request.query_params.get("semester")
    sessions = _scope_sessions(request, semester_id)
    records = AttendanceRecord.objects.filter(
        attendance_session__in=sessions
    ).select_related("attendance_session")

    marked = records.filter(marking_complete=True)
    present = marked.filter(status=AttendanceStatus.PRESENT)
    late = marked.filter(status=AttendanceStatus.LATE)
    absent = marked.filter(status=AttendanceStatus.ABSENT)

    return Response(
        {
            "semester": semester_id,
            "generatedAt": timezone.now().isoformat(),
            "totalAttendanceSessions": sessions.count(),
            "totalMarked": marked.count(),
            "present": present.count(),
            "late": late.count(),
            "absent": absent.count(),
            "attendancePercentage": pct(
                present.count() + late.count(), marked.count()
            ),
            "totalStudents": _scoped_total_students(request, sessions, semester_id),
            "studentsAtRisk": students_at_risk(marked),
        }
    )


@api_view(["GET"])
@permission_classes([IsAdminOrTeacher])
def by_subject(request):
    semester_id = request.query_params.get("semester")
    sessions = _scope_sessions(request, semester_id)
    rows = (
        AttendanceRecord.objects.filter(
            attendance_session__in=sessions, marking_complete=True
        )
        .select_related("attendance_session__subject", "attendance_session", "student")
        .values("attendance_session__subject__id", "attendance_session__subject__name")
        .annotate(
            total=Count("id"),
            present=Count("id", filter=Q(status=AttendanceStatus.PRESENT)),
            late=Count("id", filter=Q(status=AttendanceStatus.LATE)),
        )
    )
    data = []
    for row in rows:
        present = row["present"]
        late = row["late"]
        data.append(
            {
                "subjectId": row["attendance_session__subject__id"],
                "subjectName": row["attendance_session__subject__name"],
                "total": row["total"],
                "present": present,
                "late": late,
                "percentage": pct(present + late, row["total"]),
            }
        )
    return Response(data)


def students_at_risk(marked_records, threshold=75.0, limit=20):
    """Students below the attendance threshold, most at-risk first.

    ``marked_records`` must already be scoped to the requester's sessions.
    """
    profiles = {}
    for _session_id, student_id, status in marked_records.values_list(
        "attendance_session_id", "student_id", "status"
    ):
        profile = profiles.setdefault(
            student_id, {"marked": 0, "present": 0, "late": 0, "absent": 0}
        )
        profile["marked"] += 1
        if status == AttendanceStatus.PRESENT:
            profile["present"] += 1
        elif status == AttendanceStatus.LATE:
            profile["late"] += 1
        elif status == AttendanceStatus.ABSENT:
            profile["absent"] += 1

    result = []
    students = {
        s.pk: s
        for s in Student.objects.filter(pk__in=profiles.keys()).select_related("section")
    }
    for student_id, profile in profiles.items():
        ratio = pct(
            profile["present"] + profile["late"], profile["marked"]
        )
        student = students.get(student_id)
        if student is None or ratio >= threshold:
            continue
        result.append(
            {
                "studentId": student_id,
                "name": student.name,
                "rollNo": student.roll_no,
                "section": student.section.name if student.section else None,
                "marked": profile["marked"],
                "present": profile["present"],
                "late": profile["late"],
                "absent": profile["absent"],
                "percentage": ratio,
            }
        )
    result.sort(key=lambda row: row["percentage"])
    return result[:limit]


def _by_subject_rows(sessions):
    """Per-subject marked-record aggregates for the admin analytics payload."""
    rows = (
        AttendanceRecord.objects.filter(
            attendance_session__in=sessions, marking_complete=True
        )
        .values(
            "attendance_session__subject__id",
            "attendance_session__subject__code",
            "attendance_session__subject__name",
            "attendance_session__subject__semester__id",
            "attendance_session__subject__semester__name",
            "attendance_session__subject__credits",
        )
        .annotate(
            marked=Count("id"),
            present=Count("id", filter=Q(status=AttendanceStatus.PRESENT)),
            late=Count("id", filter=Q(status=AttendanceStatus.LATE)),
            absent=Count("id", filter=Q(status=AttendanceStatus.ABSENT)),
        )
    )
    data = []
    for row in rows:
        subject_id = row["attendance_session__subject__id"]
        marked = row["marked"]
        data.append(
            {
                "subjectId": subject_id,
                "subjectCode": row["attendance_session__subject__code"],
                "subjectName": row["attendance_session__subject__name"],
                "semesterId": row["attendance_session__subject__semester__id"],
                "semesterName": row["attendance_session__subject__semester__name"],
                "credits": row["attendance_session__subject__credits"],
                "sessions": AttendanceSession.objects.filter(
                    subject_id=subject_id, pk__in=sessions
                ).count(),
                "marked": marked,
                "present": row["present"],
                "late": row["late"],
                "absent": row["absent"],
                "percentage": pct(row["present"] + row["late"], marked),
            }
        )
    data.sort(key=lambda r: r["percentage"], reverse=True)
    return data


def _by_section_rows(sessions):
    """Per-section aggregates; sections with students but no records appear
    with a zero percentage so admins can see silent cohorts."""
    aggregates = (
        AttendanceRecord.objects.filter(
            attendance_session__in=sessions, marking_complete=True
        )
        .values("attendance_session__sections__id")
        .annotate(
            marked=Count("id"),
            present=Count("id", filter=Q(status=AttendanceStatus.PRESENT)),
            late=Count("id", filter=Q(status=AttendanceStatus.LATE)),
            absent=Count("id", filter=Q(status=AttendanceStatus.ABSENT)),
        )
    )
    acc = {}
    for row in aggregates:
        section_id = row["attendance_session__sections__id"]
        if section_id is None:
            continue
        item = acc.setdefault(section_id, {"marked": 0, "present": 0, "late": 0, "absent": 0})
        for key in ("marked", "present", "late", "absent"):
            item[key] += row[key]

    data = []
    for section in Section.objects.select_related("semester"):
        stats = acc.get(section.pk, {"marked": 0, "present": 0, "late": 0, "absent": 0})
        data.append(
            {
                "sectionId": section.pk,
                "sectionName": section.name,
                "semesterName": section.semester.name,
                "sessions": AttendanceSession.objects.filter(
                    sections__id=section.pk, pk__in=sessions
                ).distinct().count(),
                "studentCount": Student.objects.filter(section_id=section.pk).count(),
                "marked": stats["marked"],
                "present": stats["present"],
                "late": stats["late"],
                "absent": stats["absent"],
                "percentage": pct(stats["present"] + stats["late"], stats["marked"]),
            }
        )
    data.sort(key=lambda r: r["sectionName"])
    return data


def _student_roster(marked_records):
    """Full student roster with per-student attendance profiles.

    Students without any marking get ``percentage: None`` — never a false
    default of 0% — so the admin UI can distinguish "no data" from "absent".
    """
    profiles = {}
    for student_id, status in marked_records.values_list("student_id", "status"):
        profile = profiles.setdefault(
            student_id, {"marked": 0, "present": 0, "late": 0, "absent": 0}
        )
        profile["marked"] += 1
        if status == AttendanceStatus.PRESENT:
            profile["present"] += 1
        elif status == AttendanceStatus.LATE:
            profile["late"] += 1
        elif status == AttendanceStatus.ABSENT:
            profile["absent"] += 1

    rows = []
    students = Student.objects.select_related("section__semester")
    for student in students:
        profile = profiles.get(
            student.pk, {"marked": 0, "present": 0, "late": 0, "absent": 0}
        )
        percentage = None
        if profile["marked"]:
            percentage = pct(profile["present"] + profile["late"], profile["marked"])
        rows.append(
            {
                "studentId": student.pk,
                "studentCode": student.student_id,
                "rollNo": student.roll_no,
                "name": student.name,
                "sectionId": student.section_id,
                "sectionName": student.section.name if student.section else None,
                "semesterId": student.semester_id,
                "semesterName": student.semester.name if student.semester else None,
                "guardianName": student.guardian_name,
                "guardianPhone": student.guardian_phone,
                "marked": profile["marked"],
                "present": profile["present"],
                "late": profile["late"],
                "absent": profile["absent"],
                "percentage": percentage,
            }
        )
    rows.sort(key=lambda r: r["name"])
    return rows


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_dashboard(request):
    """Institution-wide analytics for the admin-only dashboard and reports.

    Admin-only (teachers keep using the scoped `/summary/` contract). One
    authoritative payload so the frontend admin surfaces never fall back to
    local mock numbers or secondary list endpoints.
    """
    semester_id = request.query_params.get("semester")
    sessions = AttendanceSession.objects.all()
    if semester_id:
        sessions = sessions.filter(subject__semester_id=semester_id)

    records = AttendanceRecord.objects.filter(attendance_session__in=sessions)
    marked = records.filter(marking_complete=True)
    present = marked.filter(status=AttendanceStatus.PRESENT)
    late = marked.filter(status=AttendanceStatus.LATE)
    absent = marked.filter(status=AttendanceStatus.ABSENT)

    semesters = Semester.objects.all()

    return Response(
        {
            "semester": semester_id,
            "generatedAt": timezone.now().isoformat(),
            "counts": {
                "totalStudents": Student.objects.count(),
                "totalTeachers": Teacher.objects.count(),
                "totalSemesters": semesters.count(),
                "activeSemesters": semesters.filter(
                    status=SemesterStatus.ACTIVE
                ).count(),
                "totalSections": Section.objects.count(),
                "totalSubjects": Subject.objects.count(),
            },
            "attendance": {
                "totalAttendanceSessions": sessions.count(),
                "totalMarked": marked.count(),
                "present": present.count(),
                "late": late.count(),
                "absent": absent.count(),
                "attendancePercentage": pct(
                    present.count() + late.count(), marked.count()
                ),
            },
            "studentsAtRisk": students_at_risk(marked),
            "bySubject": _by_subject_rows(sessions),
            "bySection": _by_section_rows(sessions),
            "studentRoster": _student_roster(marked),
        }
    )