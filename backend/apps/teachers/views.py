from collections import defaultdict

from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.academics.models import AssignmentStatus, TeacherAssignment
from apps.accounts.permissions import AdminOrTeacherRead, IsTeacherUser
from apps.attendance.models import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
)
from apps.students.models import Student
from apps.teachers.models import Teacher
from apps.teachers.serializers import TeacherSerializer

ATTENDED_STATUSES = frozenset(
    {AttendanceStatus.PRESENT, AttendanceStatus.LATE}
)


class TeacherViewSet(viewsets.ModelViewSet):
    queryset = Teacher.objects.all()
    serializer_class = TeacherSerializer
    permission_classes = [AdminOrTeacherRead]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "email", "teacher_id", "department"]
    ordering_fields = ["name"]

    @action(detail=False, methods=["get"], permission_classes=[IsAuthenticated])
    def me(self, request):
        teacher = getattr(request.user, "teacher_profile", None)
        if teacher is None:
            raise NotFound("No teacher profile is linked to this account.")
        return Response(self.get_serializer(teacher).data)

    @action(detail=False, methods=["get"], permission_classes=[IsTeacherUser])
    def students(self, request):
        """The authenticated teacher's enrolled-student roster.

        Includes each student's attendance summary scoped strictly to the
        requesting teacher's own attendance sessions — never institution-wide.
        Identity comes from the authoritative ``teacher_profile`` linkage.
        """
        teacher = getattr(request.user, "teacher_profile", None)
        if teacher is None:
            raise NotFound("No teacher profile is linked to this account.")

        section_ids = list(
            TeacherAssignment.objects.filter(
                teacher=teacher, status=AssignmentStatus.ACTIVE
            ).values_list("section_id", flat=True).distinct()
        )

        students = (
            Student.objects.filter(section_id__in=section_ids)
            .select_related("section", "semester")
            .order_by("roll_no")
        )

        summaries = defaultdict(lambda: {"marked": 0, "present": 0, "late": 0, "absent": 0})
        records = (
            AttendanceRecord.objects.filter(
                attendance_session__teacher=teacher,
                marking_complete=True,
            )
            .values_list("student_id", "status")
        )
        for student_id, status in records:
            bucket = summaries[student_id]
            bucket["marked"] += 1
            if status == AttendanceStatus.PRESENT:
                bucket["present"] += 1
            elif status == AttendanceStatus.LATE:
                bucket["late"] += 1
            elif status == AttendanceStatus.ABSENT:
                bucket["absent"] += 1

        data = []
        for student in students:
            raw = summaries.get(student.pk, {"marked": 0, "present": 0, "late": 0, "absent": 0})
            present = raw["present"] + raw["late"]
            data.append(
                {
                    "id": student.pk,
                    "student_id": student.student_id,
                    "roll_no": student.roll_no,
                    "name": student.name,
                    "email": student.email,
                    "phone": student.phone,
                    "avatar": student.avatar,
                    "section_name": student.section.name if student.section else None,
                    "semester_name": student.semester.name if student.semester else None,
                    "semester_code": student.semester.code if student.semester else None,
                    "attendance_summary": {
                        "marked": raw["marked"],
                        "present": present,
                        "absent": raw["absent"],
                        "late": raw["late"],
                        "percentage": (
                            round((present / raw["marked"]) * 100, 1)
                            if raw["marked"]
                            else 0.0
                        ),
                    },
                }
            )
        return Response(data)

    @action(detail=False, methods=["get"], permission_classes=[IsTeacherUser])
    def reports(self, request):
        """Per-class attendance reports for the authenticated teacher.

        One report per active assignment (subject × section), with per-student
        metrics (attended/total sessions, percentage, exam eligibility) computed
        from the teacher's own attendance sessions covering that section.
        """
        teacher = getattr(request.user, "teacher_profile", None)
        if teacher is None:
            raise NotFound("No teacher profile is linked to this account.")

        assignments = (
            TeacherAssignment.objects.filter(
                teacher=teacher, status=AssignmentStatus.ACTIVE
            )
            .select_related("section", "semester", "subject")
        )
        if not assignments.exists():
            return Response([])

        sessions = AttendanceSession.objects.filter(teacher=teacher)
        subjects_by_session = dict(sessions.values_list("id", "subject_id"))

        section_ids_by_session = defaultdict(list)
        for session_id, section_id in sessions.values_list("id", "sections__id"):
            section_ids_by_session[session_id].append(section_id)

        students = (
            Student.objects.filter(section_id__in=assignments.values("section_id"))
            .select_related("section")
            .order_by("roll_no")
        )
        roster = defaultdict(list)
        for student in students:
            roster[student.section_id].append(student)

        records = defaultdict(set)
        marked_records = (
            AttendanceRecord.objects.filter(
                attendance_session__in=sessions, marking_complete=True
            )
            .values_list("attendance_session_id", "student_id", "status")
        )
        for session_id, student_id, status in marked_records:
            if status in ATTENDED_STATUSES:
                records[session_id].add(student_id)

        data = []
        for assignment in assignments:
            session_ids = {
                session_id
                for session_id, subject_id in subjects_by_session.items()
                if subject_id == assignment.subject_id
                and assignment.section_id in section_ids_by_session[session_id]
            }
            metrics = []
            for student in roster.get(assignment.section_id, []):
                attended = 0
                for session_id in session_ids:
                    if student.pk in records[session_id]:
                        attended += 1
                total = len(session_ids)
                percentage = round((attended / total) * 100, 1) if total else 0.0
                metrics.append(
                    {
                        "studentId": student.pk,
                        "name": student.name,
                        "rollNo": student.roll_no,
                        "studentCode": student.student_id,
                        "sectionName": (
                            student.section.name if student.section else ""
                        ),
                        "attendedSessions": attended,
                        "totalSessions": total,
                        "percentage": percentage,
                        "status": "Clear" if percentage >= 75 else "Shortage",
                    }
                )
            average_pct_total = 0.0
            for metric in metrics:
                average_pct_total += float(metric["percentage"])
            average = round(average_pct_total / len(metrics), 1) if metrics else 0.0
            data.append(
                {
                    "classId": assignment.pk,
                    "subject": {
                        "id": assignment.subject_id,
                        "code": assignment.subject.code,
                        "name": assignment.subject.name,
                    },
                    "classType": assignment.subject.type,
                    "semester": {
                        "id": assignment.semester_id,
                        "name": assignment.semester.name,
                        "code": assignment.semester.code,
                    },
                    "sections": [
                        {"id": assignment.section_id, "name": assignment.section.name}
                    ],
                    "isCombined": False,
                    "sessionCount": len(session_ids),
                    "averagePercentage": average,
                    "studentMetrics": metrics,
                }
            )
        return Response(data)

    def get_queryset(self):
        if self.request.user.role == "teacher":
            teacher = getattr(self.request.user, "teacher_profile", None)
            if teacher is None:
                return self.queryset.none()
            return Teacher.objects.filter(pk=teacher.pk)
        queryset = self.queryset
        status = self.request.query_params.get("status")
        department = self.request.query_params.get("department")
        if status:
            queryset = queryset.filter(status=status)
        if department:
            queryset = queryset.filter(department__icontains=department)
        return queryset