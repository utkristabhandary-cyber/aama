"""Admin-only preview + history + confirm for generic institutional Excel imports.

Phase A exposes preview and list only. Phase B adds the student confirm
endpoint (POST /api/imports/students/confirm/). Phase C adds the teacher
confirm endpoint (POST /api/imports/teachers/confirm/).  Confirm views
re-validate every stored row against the current database before committing
inside a single ``transaction.atomic()`` block.

Phase H adds two administrative read-only endpoints:

- GET /api/imports/<kind>/template/ -- headers-only .xlsx template for the
  official (student) or current-AAMS (teacher) workbook contract.
- GET /api/imports/<kind>/export/    -- server-backed .xlsx export of the real
  data, with headers chosen so the file round-trips through this importer.

The timetable lives in apps.academics (TimetableImportViewSet exposes its own
``template`` / ``export`` actions). Everything here is admin-only; the backend
is the sole authorization authority.
"""
import uuid
from typing import Callable

from django.db import transaction
from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.academics.timetable_import import ImportFileError, ImportRowError
from apps.accounts.permissions import IsAdminUser
from apps.imports.contracts import (
    STUDENT_TEMPLATE_FILENAME,
    TEACHER_TEMPLATE_FILENAME,
    STUDENT_EXPORT_FILENAME,
    TEACHER_EXPORT_FILENAME,
    XLSX_CONTENT_TYPE,
)
from apps.imports.engine.kinds import is_supported_kind
from apps.imports.engine.plan import prepare_import_preview
from apps.imports.models import ImportSession


def _xlsx_download(content, filename):
    """Wrap generated .xlsx bytes in a deterministic attachment response."""
    response = HttpResponse(content, content_type=XLSX_CONTENT_TYPE)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def serialize_session(session):
    return {
        "kind": session.kind,
        "uuid": str(session.uuid),
        "file_name": session.file_name,
        "file_size": session.file_size,
        "sheet_name": session.sheet_name,
        "sheet_count": session.sheet_count,
        "total_rows": session.total_rows,
        "status": session.status,
        "created_at": session.created_at.isoformat(),
        "confirmed_at": (
            session.confirmed_at.isoformat() if session.confirmed_at else None
        ),
        "summary": session.summary,
    }


def _is_valid_uuid(value):
    try:
        uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return False
    return True


def _unknown_kind_response(kind):
    return Response(
        {
            "detail": f"Unsupported import kind '{kind}'. Supported kinds: "
            "students, teachers.",
            "code": "kind_unknown",
        },
        status=status.HTTP_404_NOT_FOUND,
    )


class ImportPreviewView(APIView):
    """POST /api/imports/<kind>/preview/ — admin-only system check."""

    permission_classes = [IsAdminUser]

    def post(self, request, kind):
        if not is_supported_kind(kind):
            return _unknown_kind_response(kind)
        file_obj = request.FILES.get("file")
        if file_obj is None:
            return Response(
                {
                    "detail": "A .xlsx file must be provided in the 'file' field.",
                    "code": "file_required",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            if kind == "students":
                from apps.imports.student_import import prepare_student_preview

                planned, summary_data = prepare_student_preview(
                    file_obj, file_obj.name
                )
            elif kind == "teachers":
                from apps.imports.teacher_import import prepare_teacher_preview

                planned, summary_data = prepare_teacher_preview(
                    file_obj, file_obj.name
                )
            else:
                planned, summary_data = prepare_import_preview(
                    file_obj, file_obj.name, kind=kind
                )
        except ImportFileError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = ImportSession.objects.create(
            kind=kind,
            created_by=request.user,
            file_name=file_obj.name,
            file_size=file_obj.size,
            sheet_name=summary_data["file"]["sheet_name"],
            sheet_count=summary_data["file"]["sheet_count"],
            total_rows=summary_data["counts"]["total_rows"],
            parsed_rows=planned,
            summary=summary_data,
            status=ImportSession.Status.PENDING,
        )
        return Response(
            {
                "session_uuid": str(session.uuid),
                "kind": kind,
                "file": {
                    "name": file_obj.name,
                    "size": file_obj.size,
                    "sheet_name": summary_data["file"]["sheet_name"],
                    "sheet_count": summary_data["file"]["sheet_count"],
                },
                "summary": summary_data,
                "rows": planned,
            }
        )


class ImportSessionListView(APIView):
    """GET /api/imports/<kind>/ — the importing admin's own session history."""

    permission_classes = [IsAdminUser]

    def get(self, request, kind):
        if not is_supported_kind(kind):
            return _unknown_kind_response(kind)
        sessions = request.user.import_sessions.filter(kind=kind)[:50]
        return Response([serialize_session(s) for s in sessions])


class ImportConfirmView(APIView):
    """POST /api/imports/<kind>/confirm/ — re-validate + atomic commit.

    Body: {"session_uuid": "<uuid>"}

    Subclasses bind ``kind`` and the per-kind executor module. All-or-nothing:
    any blocking error row → entire import refused (400).
    """

    permission_classes = [IsAdminUser]
    kind = None
    executor: Callable

    def post(self, request):
        kind = self.kind
        session_uuid = request.data.get("session_uuid")
        if not session_uuid:
            return Response(
                {
                    "detail": "session_uuid is required.",
                    "code": "session_uuid_required",
                },
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
                session = ImportSession.objects.select_for_update().get(
                    uuid=session_uuid,
                    kind=kind,
                    created_by=request.user,
                )
                if session.status == ImportSession.Status.CONFIRMED:
                    return Response(
                        {
                            "detail": "This session has already been confirmed.",
                            "code": "already_confirmed",
                            "session": serialize_session(session),
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                rechecked, summary = self.executor(session)
        except ImportSession.DoesNotExist:
            return Response(
                {
                    "detail": "Session not found or not owned by you.",
                    "code": "session_not_found",
                },
                status=status.HTTP_404_NOT_FOUND,
            )
        except ImportRowError as exc:
            return Response(
                {"detail": exc.message, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "session": serialize_session(
                    ImportSession.objects.get(pk=session.pk)
                ),
                "result": summary.get("confirmed", {}),
            }
        )


class StudentImportConfirmView(ImportConfirmView):
    """POST /api/imports/students/confirm/ — student atomic commit."""

    kind = "students"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from apps.imports.student_import import execute_student_confirm

        self.executor = execute_student_confirm


class TeacherImportConfirmView(ImportConfirmView):
    """POST /api/imports/teachers/confirm/ — teacher atomic commit."""

    kind = "teachers"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        from apps.imports.teacher_import import execute_teacher_confirm

        self.executor = execute_teacher_confirm


class ImportTemplateView(APIView):
    """GET /api/imports/<kind>/template/ — headers-only .xlsx (admin-only).

    ``students`` returns the official institutional roster format (verbatim
    column list + contract sheet). ``teachers`` returns the current AAMS
    system template — explicitly labelled, because the institution has not yet
    supplied a teacher workbook. The timetable template lives under
    ``/api/academics/timetable-import/template/``.
    """

    permission_classes = [IsAdminUser]

    def get(self, request, kind):
        if kind == "students":
            from apps.imports.templates import build_student_template_bytes

            content = build_student_template_bytes()
            filename = STUDENT_TEMPLATE_FILENAME
        elif kind == "teachers":
            from apps.imports.templates import build_teacher_template_bytes

            content = build_teacher_template_bytes()
            filename = TEACHER_TEMPLATE_FILENAME
        else:
            return _unknown_kind_response(kind)
        return _xlsx_download(content, filename)


class ImportExportView(APIView):
    """GET /api/imports/<kind>/export/ — server-backed .xlsx (admin-only).

    Exports the real database rows with alias-compatible headers so the file
    round-trips back through the matching import pipeline. The timetable
    export lives under ``/api/academics/timetable-import/export/``.
    """

    permission_classes = [IsAdminUser]

    def get(self, request, kind):
        if kind == "students":
            from apps.imports.exports import build_student_export_bytes

            content = build_student_export_bytes()
            filename = STUDENT_EXPORT_FILENAME
        elif kind == "teachers":
            from apps.imports.exports import build_teacher_export_bytes

            content = build_teacher_export_bytes()
            filename = TEACHER_EXPORT_FILENAME
        else:
            return _unknown_kind_response(kind)
        return _xlsx_download(content, filename)
