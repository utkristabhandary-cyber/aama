import uuid

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import AdminOrReadOnly, IsAdminUser
from apps.academics.models import (
    Holiday,
    Section,
    Semester,
    Subject,
    TeacherAssignment,
    TeachingSession,
    TimetableImportSession,
    TimetableSlot,
)
from apps.academics.serializers import (
    HolidaySerializer,
    SectionDetailSerializer,
    SectionSerializer,
    SemesterSerializer,
    SubjectSerializer,
    TeacherAssignmentSerializer,
    TeachingSessionSerializer,
    TimetableSlotSerializer,
)
from apps.academics.timetable_import import (
    ImportFileError,
    ImportRowError,
    execute_confirm,
    prepare_preview,
)


def _is_valid_uuid(value):
    try:
        uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return False
    return True


class SemesterViewSet(viewsets.ModelViewSet):
    queryset = Semester.objects.all()
    serializer_class = SemesterSerializer
    permission_classes = [AdminOrReadOnly]
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["start_date", "code"]


class SectionViewSet(viewsets.ModelViewSet):
    queryset = Section.objects.select_related("semester").all()
    permission_classes = [AdminOrReadOnly]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "room"]
    ordering_fields = ["semester__code", "name"]

    def get_serializer_class(self):
        return SectionDetailSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        semester_id = self.request.query_params.get("semester")
        if semester_id:
            queryset = queryset.filter(semester_id=semester_id)
        return queryset


class SubjectViewSet(viewsets.ModelViewSet):
    queryset = Subject.objects.select_related("semester").all()
    serializer_class = SubjectSerializer
    permission_classes = [AdminOrReadOnly]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["code", "name"]
    ordering_fields = ["code"]

    def get_queryset(self):
        queryset = super().get_queryset()
        semester_id = self.request.query_params.get("semester")
        if semester_id:
            queryset = queryset.filter(semester_id=semester_id)
        return queryset


class HolidayViewSet(viewsets.ModelViewSet):
    queryset = Holiday.objects.all()
    serializer_class = HolidaySerializer
    permission_classes = [AdminOrReadOnly]


class TeacherAssignmentViewSet(viewsets.ModelViewSet):
    queryset = (
        TeacherAssignment.objects.select_related(
            "teacher", "semester", "section", "subject"
        ).all()
    )
    serializer_class = TeacherAssignmentSerializer
    permission_classes = [AdminOrReadOnly]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "teacher__name",
        "subject__name",
        "subject__code",
    ]
    ordering_fields = ["semester__code", "section__name"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "teacher":
            teacher = getattr(self.request.user, "teacher_profile", None)
            if teacher is None:
                return queryset.none()
            # Teachers only ever see their own assignments; a `?teacher=` filter
            # can never be used to probe another teacher's data.
            return queryset.filter(teacher_id=teacher.pk)
        teacher_id = self.request.query_params.get("teacher")
        semester_id = self.request.query_params.get("semester")
        section_id = self.request.query_params.get("section")
        subject_id = self.request.query_params.get("subject")
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)
        if semester_id:
            queryset = queryset.filter(semester_id=semester_id)
        if section_id:
            queryset = queryset.filter(section_id=section_id)
        if subject_id:
            queryset = queryset.filter(subject_id=subject_id)
        return queryset


class TimetableViewSet(viewsets.ModelViewSet):
    queryset = (
        TimetableSlot.objects.select_related(
            "semester", "section", "subject", "teacher"
        )
        .prefetch_related("sections")
        .all()
    )
    serializer_class = TimetableSlotSerializer
    permission_classes = [AdminOrReadOnly]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "teacher":
            teacher = getattr(self.request.user, "teacher_profile", None)
            if teacher is None:
                return queryset.none()
            # Teachers only ever see their own timetable; `?teacher=` is ignored
            # for teacher-role users so they cannot probe other teachers.
            return queryset.filter(teacher_id=teacher.pk)
        semester_id = self.request.query_params.get("semester")
        section_id = self.request.query_params.get("section")
        teacher_id = self.request.query_params.get("teacher")
        day = self.request.query_params.get("day")
        if semester_id:
            queryset = queryset.filter(semester_id=semester_id)
        if section_id:
            queryset = queryset.filter(
                Q(sections=section_id) | Q(section_id=section_id)
            )
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)
        if day:
            queryset = queryset.filter(day=day)
        return queryset


class TeachingSessionViewSet(viewsets.ModelViewSet):
    queryset = (
        TeachingSession.objects.select_related(
            "semester", "subject", "teacher"
        )
        .prefetch_related("sections")
        .all()
    )
    serializer_class = TeachingSessionSerializer
    permission_classes = [AdminOrReadOnly]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "teacher":
            teacher = getattr(self.request.user, "teacher_profile", None)
            if teacher is None:
                return queryset.none()
            # Teachers only ever see their own teaching sessions.
            return queryset.filter(teacher_id=teacher.pk)
        teacher_id = self.request.query_params.get("teacher")
        semester_id = self.request.query_params.get("semester")
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)
        if semester_id:
            queryset = queryset.filter(semester_id=semester_id)
        return queryset


def _serialize_import_session(session):
    return {
        "uuid": str(session.uuid),
        "file_name": session.file_name,
        "file_size": session.file_size,
        "sheet_name": session.sheet_name,
        "sheet_count": session.sheet_count,
        "total_rows": session.total_rows,
        "status": session.status,
        "created_at": session.created_at.isoformat(),
        "confirmed_at": session.confirmed_at.isoformat() if session.confirmed_at else None,
        "summary": session.summary,
    }


class TimetableImportViewSet(viewsets.ViewSet):
    """Admin-only staging & confirmation of student timetable .xlsx imports.

    ``preview`` parses, matches and validates the uploaded workbook, stores the
    server-side normalized rows on a pending session, and returns the plan.
    ``confirm`` re-validates that session against the current database and
    commits the planned rows in a single transaction. ``list`` returns the
    importing admin's own session history.
    """

    permission_classes = [IsAdminUser]

    def list(self, request):
        sessions = request.user.timetable_imports.all()[:50]
        return Response([_serialize_import_session(s) for s in sessions])

    @action(detail=False, methods=["post"])
    def preview(self, request):
        file_obj = request.FILES.get("file")
        if file_obj is None:
            return Response(
                {"detail": "A .xlsx file must be provided in the 'file' field."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            planned, summary, file_meta = prepare_preview(file_obj, file_obj.name)
        except ImportFileError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = TimetableImportSession.objects.create(
            created_by=request.user,
            file_name=file_obj.name,
            file_size=file_obj.size,
            sheet_name=file_meta["sheet_name"],
            sheet_count=file_meta["sheet_count"],
            total_rows=len(planned),
            parsed_rows=planned,
            summary=summary,
            status=TimetableImportSession.Status.PENDING,
        )
        return Response(
            {
                "session_uuid": str(session.uuid),
                "file": {
                    "sheet_name": file_meta["sheet_name"],
                    "sheet_count": file_meta["sheet_count"],
                },
                "summary": summary,
                "rows": planned,
            }
        )

    @action(detail=False, methods=["post"])
    def confirm(self, request):
        session_uuid = request.data.get("session_uuid")
        if not session_uuid:
            return Response(
                {"detail": "'session_uuid' is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not _is_valid_uuid(session_uuid):
            return Response(
                {
                    "detail": "session_uuid is not a valid UUID.",
                    "code": "session_uuid_invalid",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            with transaction.atomic():
                session = TimetableImportSession.objects.select_for_update().get(
                    uuid=session_uuid, created_by=request.user
                )
                if session.status == TimetableImportSession.Status.CONFIRMED:
                    return Response(
                        {
                            "detail": "This import session has already been confirmed.",
                            "code": "already_confirmed",
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                planned, summary = execute_confirm(session)
        except TimetableImportSession.DoesNotExist:
            return Response(
                {"detail": "No pending import session with that UUID."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except ImportRowError as exc:
            # Deterministic blocking failure (e.g. a teacher ID no longer
            # resolves, or a row re-validated as an error) — nothing written.
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            # A mid-batch DB error rolled the transaction back; the session
            # stays pending so the admin can inspect and retry.
            return Response(
                {"detail": "The import could not be committed and was rolled back. "
                           "Review the rows and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "session_uuid": str(session.uuid),
                "summary": summary,
                "rows": planned,
            }
        )

    @action(detail=False, methods=["get"])
    def template(self, request):
        """GET /timetable-import/template/ — current AAMS timetable template.

        Headers-only .xlsx (first worksheet = the importable header row, second
        sheet = the contract summary), explicitly labelled as the current AAMS
        system format because the institution has not yet supplied an official
        timetable workbook.
        """
        from apps.imports.contracts import (
            TIMETABLE_TEMPLATE_FILENAME,
            XLSX_CONTENT_TYPE,
        )

        from apps.imports.templates import build_timetable_template_bytes

        content = build_timetable_template_bytes()
        response = HttpResponse(content, content_type=XLSX_CONTENT_TYPE)
        response["Content-Disposition"] = (
            f'attachment; filename="{TIMETABLE_TEMPLATE_FILENAME}"'
        )
        return response

    @action(detail=False, methods=["get"])
    def export(self, request):
        """GET /timetable-import/export/ — server-backed timetable .xlsx.

        Exports real slots with alias-compatible headers (section names joined
        with ``+`` for combined slots) so the file round-trips through this
        importer.
        """
        from apps.imports.contracts import (
            TIMETABLE_EXPORT_FILENAME,
            XLSX_CONTENT_TYPE,
        )

        from apps.imports.exports import build_timetable_export_bytes

        content = build_timetable_export_bytes()
        response = HttpResponse(content, content_type=XLSX_CONTENT_TYPE)
        response["Content-Disposition"] = (
            f'attachment; filename="{TIMETABLE_EXPORT_FILENAME}"'
        )
        return response