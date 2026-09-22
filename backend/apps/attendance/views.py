from django.db import transaction

from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from apps.academics.models import (
    AssignmentStatus,
    SemesterStatus,
    TeacherAssignment,
)
from apps.accounts.permissions import (
    IsAdminOrTeacher,
    IsAdminUser,
    IsStudentUser,
    IsTeacherUser,
)
from apps.attendance.models import (
    AttendanceRecord,
    AttendanceSession,
    AttendanceStatus,
    QRAttendanceSession,
)
from apps.attendance.serializers import (
    AttendanceRecordSerializer,
    AttendanceSessionSerializer,
    QRAttendanceSessionSerializer,
)
from apps.attendance.services import (
    check_in_student,
    finalize_attendance_session,
    find_duplicate_session,
    mark_qr_student,
    mark_qr_student_via_code,
    roll_call_for_session,
    start_qr_session,
    stop_qr_session,
    summarize_student_attendance,
    validate_qr,
)
from apps.attendance.throttling import QrActionThrottle, QrCheckInThrottle
from apps.students.models import Student
from apps.teachers.models import Teacher


def _teacher_for_request(request):
    """Resolve the Teacher linked to the authenticated user.

    Identity is always taken from the authoritative ``teacher_profile`` linkage
    on the account — never from an email string match against the Teacher
    table, which would be a non-deterministic first-record fallback.
    """
    return getattr(request.user, "teacher_profile", None)


class AttendanceSessionViewSet(ModelViewSet):
    queryset = AttendanceSession.objects.select_related("subject", "teacher")
    serializer_class = AttendanceSessionSerializer

    def get_permissions(self):
        # Staff-facing roles manage sessions; students can only read their own
        # summary via AttendanceRecordViewSet.my. Teachers are further scoped to
        # their own sessions in get_queryset/_assert_owner_or_admin — an admin
        # (who has no teacher_profile) is allowed to manage any draft session.
        return [IsAdminOrTeacher()]

    def get_queryset(self):
        queryset = self.queryset
        if self.request.user.role == "teacher":
            teacher = _teacher_for_request(self.request)
            if teacher is None:
                return queryset.none()
            return queryset.filter(teacher_id=teacher.pk)
        teacher = self.request.query_params.get("teacher")
        if teacher:
            queryset = queryset.filter(teacher_id=teacher)
        subject = self.request.query_params.get("subject")
        if subject:
            queryset = queryset.filter(subject_id=subject)
        section = self.request.query_params.get("section")
        if section:
            queryset = queryset.filter(sections__id=section)
        semester = self.request.query_params.get("semester")
        if semester:
            queryset = queryset.filter(sections__semester_id=semester)
        return queryset.distinct()

    @staticmethod
    def _validate_sections_for_teacher(validated_data, teacher, instance=None):
        subject = validated_data.get("subject")
        sections = validated_data.get("sections")
        teaching_session = validated_data.get("teaching_session")

        if subject is None and instance is not None:
            subject = instance.subject
        if sections is None and instance is not None:
            sections = list(instance.sections.all())
        if teaching_session is None and instance is not None:
            teaching_session = instance.teaching_session

        sections = list(sections or [])
        if not sections:
            raise serializers.ValidationError(
                {"section_ids": "At least one section is required."}
            )
        if subject is None:
            raise serializers.ValidationError(
                {"subject": "Subject is required."}
            )

        if subject.semester.status == SemesterStatus.COMPLETED:
            raise serializers.ValidationError(
                {"subject": "Attendance cannot be recorded for a completed semester."}
            )

        if teaching_session is not None:
            if teaching_session.teacher_id != teacher.pk:
                raise serializers.ValidationError(
                    {"teaching_session": "Teaching session does not belong to you."}
                )
            if teaching_session.subject_id != subject.pk:
                raise serializers.ValidationError(
                    {
                        "teaching_session": (
                            "Teaching session subject does not match the session."
                        )
                    }
                )
            ts_section_ids = set(
                teaching_session.sections.values_list("id", flat=True)
            )
            not_covered = set(s.pk for s in sections) - ts_section_ids
            if not_covered:
                raise serializers.ValidationError(
                    {
                        "section_ids": (
                            "All sections must be covered by the linked teaching "
                            "session."
                        )
                    }
                )

        assigned = set(
            TeacherAssignment.objects.filter(
                teacher=teacher, subject=subject, status=AssignmentStatus.ACTIVE
            ).values_list("section_id", flat=True)
        )
        missing = set(s.pk for s in sections) - assigned
        if missing:
            raise serializers.ValidationError(
                {
                    "section_ids": (
                        "You are not assigned to teach this subject in all selected "
                        "sections."
                    )
                }
            )

    @staticmethod
    def _assert_owner_or_admin(request, session):
        if request.user.role == "admin":
            return
        teacher = _teacher_for_request(request)
        if teacher is None or session.teacher_id != teacher.pk:
            raise PermissionDenied("You can only manage your own attendance sessions.")

    def perform_create(self, serializer):
        teacher = _teacher_for_request(self.request)
        if teacher is None:
            raise PermissionDenied("No teacher profile for this user.")
        self._validate_sections_for_teacher(serializer.validated_data, teacher)
        subject_id = serializer.validated_data["subject"].pk
        section_ids = [
            s.pk for s in serializer.validated_data.get("sections", [])
        ]
        with transaction.atomic():
            # Serialize creation per teacher so the duplicate check and the
            # insert cannot race (two concurrent identical creates both pass
            # find_duplicate_session, then both insert). Locking the teacher
            # row mirrors the import-session select_for_update pattern.
            Teacher.objects.select_for_update().get(pk=teacher.pk)
            duplicate = find_duplicate_session(
                teacher,
                subject_id,
                serializer.validated_data["session_date"],
                section_ids,
            )
            if duplicate is not None:
                raise serializers.ValidationError(
                    {
                        "section_ids": (
                            "Attendance for this subject and section(s) is "
                            "already recorded on this date (session "
                            f"#{duplicate.pk})."
                        )
                    }
                )
            serializer.save(created_by=self.request.user, teacher=teacher)

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.is_finalized:
            raise PermissionDenied("Attendance already submitted.")
        self._assert_owner_or_admin(self.request, instance)
        teacher = _teacher_for_request(self.request)
        if teacher is None:
            raise PermissionDenied("No teacher profile for this user.")
        self._validate_sections_for_teacher(
            serializer.validated_data, teacher, instance=instance
        )
        subject = serializer.validated_data.get("subject", instance.subject)
        sections = serializer.validated_data.get(
            "sections", list(instance.sections.all())
        )
        session_date = serializer.validated_data.get(
            "session_date", instance.session_date
        )
        duplicate = find_duplicate_session(
            teacher,
            subject.pk,
            session_date,
            [s.pk for s in sections],
            exclude_id=instance.pk,
        )
        if duplicate is not None:
            raise serializers.ValidationError(
                {
                    "section_ids": (
                        "Attendance for this subject and section(s) is already "
                        f"recorded on this date (session #{duplicate.pk})."
                    )
                }
            )
        serializer.save()

    def perform_destroy(self, instance):
        if instance.is_finalized:
            raise PermissionDenied("Attendance already submitted.")
        self._assert_owner_or_admin(self.request, instance)
        instance.delete()

    @action(detail=True, methods=["post"])
    def mark(self, request, pk=None):
        session = self.get_object()
        self._assert_owner_or_admin(request, session)
        if session.is_finalized:
            return Response(
                {"detail": "Attendance already submitted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        student_id = request.data.get("studentId") or request.data.get("student")
        if not student_id:
            return Response(
                {"detail": "studentId is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        student = Student.objects.filter(pk=student_id).first()
        if student is None:
            return Response(
                {"detail": "Student not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        section_ids = set(session.sections.values_list("id", flat=True))
        if student.section_id not in section_ids:
            return Response(
                {"detail": "Student is not part of this session's sections."},
                status=status.HTTP_403_FORBIDDEN,
            )
        status_ = (
            request.data.get("status") or AttendanceStatus.PRESENT.value
        ).lower()
        if status_ not in AttendanceStatus.values:
            return Response(
                {"detail": "Invalid attendance status."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        record = mark_qr_student(session, student, status_)
        return Response(AttendanceRecordSerializer(record).data)

    @action(detail=True, methods=["post"])
    def bulk_mark(self, request, pk=None):
        """Mark multiple students in one atomic, fully-validated request.

        Every entry is validated before any write and the whole batch is applied
        inside a single transaction — one invalid row (unknown student, student
        outside the session's sections, or bad status) rejects the entire batch
        without leaving partial records behind. The teacher may only bulk-mark
        their own sessions; admins may manage any non-finalized session.
        """
        session = self.get_object()
        self._assert_owner_or_admin(request, session)
        if session.is_finalized:
            return Response(
                {"detail": "Attendance already submitted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        marks = request.data.get("marks")
        if not isinstance(marks, list) or not marks:
            return Response(
                {"detail": "marks must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        section_ids = set(session.sections.values_list("id", flat=True))
        entries = []
        for idx, item in enumerate(marks):
            student_id = item.get("studentId") if isinstance(item, dict) else None
            if not student_id:
                return Response(
                    {"detail": f"marks[{idx}] is missing a studentId."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            student = Student.objects.filter(pk=student_id).first()
            if student is None:
                return Response(
                    {"detail": f"Student {student_id} not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if student.section_id not in section_ids:
                return Response(
                    {"detail": f"Student {student_id} is not part of this session's sections."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            status_ = (
                item.get("status") or AttendanceStatus.PRESENT.value
            ).lower()
            if status_ not in AttendanceStatus.values:
                return Response(
                    {"detail": f"Invalid attendance status for student {student_id}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            entries.append((student, status_))

        with transaction.atomic():
            records = [
                mark_qr_student(session, student, status_) for student, status_ in entries
            ]
        return Response(AttendanceRecordSerializer(records, many=True).data)

    @action(detail=True, methods=["get"])
    def roll(self, request, pk=None):
        session = self.get_object()
        self._assert_owner_or_admin(request, session)
        return Response(roll_call_for_session(session))

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        session = self.get_object()
        self._assert_owner_or_admin(request, session)
        if session.is_finalized:
            return Response(
                {"detail": "Attendance already submitted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        finalize_attendance_session(
            session,
            marked_ids=request.data.get("markedIds"),
            late_reason=request.data.get("lateReason", ""),
        )
        return Response(AttendanceSessionSerializer(session).data)


class AttendanceRecordViewSet(ModelViewSet):
    queryset = AttendanceRecord.objects.select_related("student", "attendance_session")
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAdminOrTeacher]

    def get_queryset(self):
        queryset = self.queryset
        if self.request.user.role == "teacher":
            teacher = _teacher_for_request(self.request)
            if teacher is None:
                return queryset.none()
            queryset = queryset.filter(attendance_session__teacher_id=teacher.pk)
        session_id = self.request.query_params.get("session")
        if session_id:
            queryset = queryset.filter(attendance_session_id=session_id)
        return queryset

    @action(
        detail=False,
        methods=["get"],
        permission_classes=[IsStudentUser],
    )
    def my(self, request):
        """Return the authenticated student's own attendance summary.

        Filters by ``?semester=<id>`` / ``?subject=<id>`` are optional and always
        scoped to the authenticated student — never to client-supplied identity.
        """
        from apps.academics.models import Semester, Subject

        student = getattr(request.user, "student_profile", None)
        if student is None:
            raise NotFound("No student profile is linked to this account.")
        semester_id = request.query_params.get("semester")
        subject_id = request.query_params.get("subject")
        semester = (
            Semester.objects.filter(pk=semester_id).first() if semester_id else None
        )
        subject = (
            Subject.objects.filter(pk=subject_id).first() if subject_id else None
        )
        if (subject_id and subject is None) or (semester_id and semester is None):
            # A filter that resolves to nothing must not silently return all rows.
            empty = summarize_student_attendance(student)
            empty["overallPercentage"] = 0.0
            empty["overallPresent"] = 0
            empty["overallTotal"] = 0
            empty["subjects"] = []
            empty["logs"] = []
            return Response(empty)
        data = summarize_student_attendance(
            student, semester=semester, subject=subject
        )
        return Response(data)
    @staticmethod
    def _assert_privilege(request, session):
        if session.is_finalized:
            raise PermissionDenied("Attendance already submitted.")
        if request.user.role != "admin":
            teacher = _teacher_for_request(request)
            if teacher is None or session.teacher_id != teacher.pk:
                raise PermissionDenied(
                    "You can only manage records for your own sessions."
                )

    def perform_create(self, serializer):
        session = serializer.validated_data["attendance_session"]
        student = serializer.validated_data["student"]
        section_ids = set(session.sections.values_list("id", flat=True))
        if student.section_id not in section_ids:
            raise PermissionDenied("Student is not part of this session's sections.")
        self._assert_privilege(self.request, session)
        serializer.save()

    def perform_update(self, serializer):
        self._assert_privilege(self.request, serializer.instance.attendance_session)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_privilege(self.request, instance.attendance_session)
        instance.delete()


class QRAttendanceSessionViewSet(ModelViewSet):
    queryset = QRAttendanceSession.objects.select_related("teacher", "attendance_session")
    serializer_class = QRAttendanceSessionSerializer

    def get_permissions(self):
        if self.action == "mark":
            return [IsStudentUser()]
        if self.action in {"check_in", "validate"}:
            return [IsStudentUser()]
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [IsAdminUser()]
        if self.action == "start":
            return [IsTeacherUser()]
        return [IsAdminOrTeacher()]

    def get_throttles(self):
        throttles = super().get_throttles()
        if self.action in {"check_in", "validate", "mark"}:
            throttles = [QrCheckInThrottle()] + throttles
        if self.action == "start":
            throttles = [QrActionThrottle()] + throttles
        return throttles

    def get_queryset(self):
        queryset = self.queryset
        user = self.request.user
        if user.role == "teacher":
            teacher = _teacher_for_request(self.request)
            if teacher is None:
                return queryset.none()
            return queryset.filter(teacher_id=teacher.pk)
        if user.role == "student":
            student = getattr(user, "student_profile", None)
            if student is None or student.section_id is None:
                return queryset.none()
            return queryset.filter(
                attendance_session__sections__id=student.section_id
            ).distinct()
        if user.role == "admin":
            teacher = self.request.query_params.get("teacher")
            if teacher:
                queryset = queryset.filter(teacher_id=teacher)
        return queryset

    @action(detail=False, methods=["post"])
    def start(self, request):
        teacher = _teacher_for_request(request)
        if teacher is None:
            return Response(
                {"detail": "No teacher profile for this user."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        attendance_session = AttendanceSession.objects.filter(
            pk=request.data.get("attendanceSessionId")
        ).first()
        if attendance_session is None or attendance_session.is_finalized:
            return Response(
                {"detail": "Invalid or already submitted attendance session."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if attendance_session.teacher_id != teacher.pk:
            return Response(
                {"detail": "You can only start QR attendance for your own sessions."},
                status=status.HTTP_403_FORBIDDEN,
            )
        qr = start_qr_session(teacher, attendance_session)
        return Response(QRAttendanceSessionSerializer(qr).data)

    @action(
        detail=False,
        methods=["post"],
        url_path="check-in",
        permission_classes=[IsStudentUser()],
    )
    def check_in(self, request):
        """Server-authoritative QR check-in for the authenticated student.

        Body: ``{"qrPayload": "AAMSQR1|<id>|<TOKEN>", "network": {...}}``.
        Identity always comes from ``request.user.student_profile``; the QR is
        only proof that the student is physically scanning the classroom code.
        """
        student = getattr(request.user, "student_profile", None)
        if student is None:
            return Response(
                {"detail": "No student profile is linked to this account."},
                status=status.HTTP_403_FORBIDDEN,
            )
        # Web-only: there is no companion/device registry and no OS-attestation
        # channel, so network verification is always "unavailable" (resolved
        # inside check_in_student).
        status_code, payload = check_in_student(
            request.data.get("qrPayload"),
            student,
            network=request.data.get("network"),
        )
        return Response(payload, status=status_code)

    @action(detail=True, methods=["post"])
    def validate(self, request, pk=None):
        qr = self.get_object()
        valid, message, payload = validate_qr(qr.pk, request.data.get("code"))
        if not valid:
            return Response(
                {"detail": message, "valid": False},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"valid": True, "message": message, "payload": payload})

    @action(detail=True, methods=["post"])
    def mark(self, request, pk=None):
        qr = self.get_object()
        valid, message, _ = validate_qr(qr.pk, request.data.get("code"))
        if not valid:
            return Response(
                {"detail": message, "valid": False},
                status=status.HTTP_400_BAD_REQUEST,
            )
        student = getattr(request.user, "student_profile", None)
        if student is None:
            return Response(
                {"detail": "No student profile for this user."},
                status=status.HTTP_403_FORBIDDEN,
            )
        ok, message, record = mark_qr_student_via_code(qr, student)
        if not ok:
            return Response(
                {"detail": message, "valid": False},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(AttendanceRecordSerializer(record).data)

    @action(detail=True, methods=["post"])
    def stop(self, request, pk=None):
        qr = self.get_object()
        if request.user.role != "admin":
            teacher = _teacher_for_request(request)
            if teacher is None or qr.teacher_id != teacher.pk:
                return Response(
                    {"detail": "You can only stop your own QR sessions."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        stop_qr_session(qr)
        return Response({"detail": "QR session stopped."})