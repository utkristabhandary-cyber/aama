"""Teacher timesheet API (Phase I).

AAMS has no payroll / clock-in product. ``TimesheetEntry`` is the per-day
work/duty-hours log a teacher fills in, and this module enforces the confirmed
workflow end-to-end:

- Only CONFIRMED entries count toward the summary ledger and the admin export.
- DRAFT -> SUBMITTED (teacher or admin) -> CONFIRMED / REJECTED (admin only).
- The owner edits DRAFT / REJECTED (editing a rejected entry resets it to
  DRAFT); an admin may edit any non-confirmed entry. CONFIRMED is immutable.
- Overlaps (same teacher, same day, overlapping range) are rejected; rejected
  entries never block re-logging the same range.
- Identity is always ``request.user.teacher_profile`` for teacher roles, and
  every path is re-scoped per-request (IDOR surfaces as not-found, never as a
  leak of another teacher's row).
"""
import io

import openpyxl

from django.http import HttpResponse
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.accounts.permissions import IsAdminOrTeacher, IsAdminUser
from apps.imports.contracts import XLSX_CONTENT_TYPE

from .models import TimesheetEntry, TimesheetEntryStatus
from .serializers import TimesheetEntrySerializer
from .services import find_overlapping_entry

TIMESHEET_EXPORT_FILENAME = "aams_timesheet_export.xlsx"

TIMESHEET_EXPORT_HEADERS = [
    "Teacher ID",
    "Teacher Name",
    "Date",
    "Type",
    "Subject Code",
    "Subject Name",
    "Sections",
    "Semester",
    "Start Time",
    "End Time",
    "Duration (min)",
    "Note",
]


def _teacher_for_request(request):
    """Resolve the linked Teacher; identity never comes from the client."""
    return getattr(request.user, "teacher_profile", None)


def _base_timesheet_queryset():
    return (
        TimesheetEntry.objects.select_related(
            "teacher", "subject", "subject__semester", "semester", "created_by"
        ).prefetch_related("sections")
    )


def _timesheet_scope(request, queryset):
    """Scope rows by role identity — a teacher sees only their own entries."""
    if request.user.role == "teacher":
        teacher = _teacher_for_request(request)
        if teacher is None:
            return queryset.none()
        return queryset.filter(teacher_id=teacher.pk)
    teacher = request.query_params.get("teacher")
    if teacher:
        queryset = queryset.filter(teacher_id=teacher)
    return queryset


def _apply_filters(request, queryset):
    entry_type = request.query_params.get("type")
    if entry_type:
        queryset = queryset.filter(type=entry_type)
    semester = request.query_params.get("semester")
    if semester:
        queryset = queryset.filter(semester_id=semester)
    date_from = request.query_params.get("date_from")
    if date_from:
        queryset = queryset.filter(entry_date__gte=date_from)
    date_to = request.query_params.get("date_to")
    if date_to:
        queryset = queryset.filter(entry_date__lte=date_to)
    return queryset


def _xlsx_download(content, filename):
    response = HttpResponse(content, content_type=XLSX_CONTENT_TYPE)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def _export_workbook_bytes(entries):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Timesheet"
    sheet.append(TIMESHEET_EXPORT_HEADERS)
    for cell in sheet[1]:
        cell.font = openpyxl.styles.Font(bold=True)
    for entry in entries:
        sheet.append([
            entry.teacher.teacher_id,
            entry.teacher.name,
            entry.entry_date.isoformat(),
            entry.type,
            entry.subject.code if entry.subject_id else "",
            entry.subject.name if entry.subject_id else "",
            ", ".join(section.name for section in entry.sections.all()),
            entry.semester.code if entry.semester_id else "",
            entry.start_time.strftime("%H:%M"),
            entry.end_time.strftime("%H:%M"),
            entry.duration_minutes,
            entry.note,
        ])
    buffer = io.BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


class TimesheetEntryViewSet(ModelViewSet):
    serializer_class = TimesheetEntrySerializer

    def get_permissions(self):
        if self.action in {"confirm", "reject"}:
            return [IsAdminUser()]
        return [IsAdminOrTeacher()]

    def get_queryset(self):
        queryset = _apply_filters(self.request, _timesheet_scope(
            self.request, _base_timesheet_queryset()
        ))
        entry_status = self.request.query_params.get("status")
        if entry_status:
            queryset = queryset.filter(status=entry_status)
        return queryset

    @staticmethod
    def _assert_owner_or_admin(request, entry):
        if request.user.role == "admin":
            return
        teacher = _teacher_for_request(request)
        if teacher is None or entry.teacher_id != teacher.pk:
            raise PermissionDenied("You can only manage your own timesheet entries.")

    def _check_overlap(self, data, instance=None):
        teacher = data.get("teacher") or getattr(instance, "teacher", None)
        if teacher is None:
            return
        entry_date = data.get("entry_date") or getattr(
            instance, "entry_date", None
        )
        start_time = data.get("start_time") or getattr(instance, "start_time", None)
        end_time = data.get("end_time") or getattr(instance, "end_time", None)
        if not (entry_date and start_time and end_time):
            return
        overlap = find_overlapping_entry(
            teacher.pk,
            entry_date,
            start_time,
            end_time,
            exclude_id=instance.pk if instance else None,
        )
        if overlap is not None:
            raise serializers.ValidationError(
                {
                    "start_time": (
                        "Overlaps with entry "
                        f"#{overlap.pk} ({overlap.start_time:%H:%M}-"
                        f"{overlap.end_time:%H:%M})."
                    ),
                    "end_time": "This time range overlaps another entry.",
                }
            )

    def perform_create(self, serializer):
        user = self.request.user
        if user.role == "teacher":
            teacher = _teacher_for_request(self.request)
            if teacher is None:
                raise PermissionDenied(
                    "No teacher profile is linked to this account."
                )
            serializer.validated_data["teacher"] = teacher
        else:
            teacher = serializer.validated_data.get("teacher")
            if teacher is None:
                raise serializers.ValidationError(
                    {"teacher": "teacher is required."}
                )
        self._check_overlap(serializer.validated_data)
        serializer.save(created_by=user)

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.status == TimesheetEntryStatus.CONFIRMED:
            raise PermissionDenied("A confirmed entry is immutable.")
        user = self.request.user
        if user.role != "admin":
            teacher = _teacher_for_request(self.request)
            if teacher is None or instance.teacher_id != teacher.pk:
                raise PermissionDenied("You can only edit your own entries.")
            if instance.status == TimesheetEntryStatus.SUBMITTED:
                raise PermissionDenied(
                    "A submitted entry is awaiting admin confirmation."
                )
        if instance.status == TimesheetEntryStatus.REJECTED:
            instance.status = TimesheetEntryStatus.DRAFT
            instance.rejection_reason = ""
            instance.save(update_fields=["status", "rejection_reason", "updated_at"])
        data = dict(serializer.validated_data)
        data["teacher"] = instance.teacher
        self._check_overlap(data, instance=instance)
        serializer.save()

    def perform_destroy(self, instance):
        if instance.status == TimesheetEntryStatus.CONFIRMED:
            raise PermissionDenied("A confirmed entry is immutable.")
        user = self.request.user
        if user.role != "admin":
            teacher = _teacher_for_request(self.request)
            if teacher is None or instance.teacher_id != teacher.pk:
                raise PermissionDenied("You can only delete your own entries.")
            if instance.status == TimesheetEntryStatus.SUBMITTED:
                raise PermissionDenied("Recall the entry before deleting it.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        entry = self.get_object()
        self._assert_owner_or_admin(request, entry)
        if entry.status not in (
            TimesheetEntryStatus.DRAFT,
            TimesheetEntryStatus.REJECTED,
        ):
            return Response(
                {"detail": "Only draft or rejected entries can be submitted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        entry.status = TimesheetEntryStatus.SUBMITTED
        entry.rejection_reason = ""
        entry.save(update_fields=["status", "rejection_reason", "updated_at"])
        return Response(self.get_serializer(entry).data)

    @action(detail=True, methods=["post"])
    def recall(self, request, pk=None):
        entry = self.get_object()
        self._assert_owner_or_admin(request, entry)
        if entry.status != TimesheetEntryStatus.SUBMITTED:
            return Response(
                {"detail": "Only submitted entries can be recalled."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        entry.status = TimesheetEntryStatus.DRAFT
        entry.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(entry).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser])
    def confirm(self, request, pk=None):
        entry = self.get_object()
        if entry.status != TimesheetEntryStatus.SUBMITTED:
            return Response(
                {"detail": "Only submitted entries can be confirmed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        entry.status = TimesheetEntryStatus.CONFIRMED
        entry.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(entry).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminUser])
    def reject(self, request, pk=None):
        entry = self.get_object()
        if entry.status != TimesheetEntryStatus.SUBMITTED:
            return Response(
                {"detail": "Only submitted entries can be rejected."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reason = request.data.get("rejectionReason") or request.data.get("reason")
        if not reason or not isinstance(reason, str) or not reason.strip():
            return Response(
                {"detail": "A rejection reason is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        entry.status = TimesheetEntryStatus.REJECTED
        entry.rejection_reason = reason.strip()[:500]
        entry.save(update_fields=["status", "rejection_reason", "updated_at"])
        return Response(self.get_serializer(entry).data)


class TimesheetSummaryView(APIView):
    """GET /api/timesheet/summary/ — approved hours ledger.

    Only CONFIRMED entries count. Teachers see their own summary; admins see
    the whole ledger (optionally filtered by ``teacher`` / ``type`` /
    ``semester`` / ``date_from`` / ``date_to``).
    """

    permission_classes = [IsAdminOrTeacher]

    def get(self, request):
        queryset = _apply_filters(
            request, _timesheet_scope(request, _base_timesheet_queryset())
        ).filter(status=TimesheetEntryStatus.CONFIRMED)
        entries = list(queryset)

        by_type = {}
        by_day = {}
        per_teacher = {}
        for entry in entries:
            by_type[entry.type] = by_type.get(entry.type, 0) + entry.duration_minutes
            by_day[str(entry.entry_date)] = (
                by_day.get(str(entry.entry_date), 0) + entry.duration_minutes
            )
            bucket = per_teacher.setdefault(
                entry.teacher_id,
                {
                    "teacher": entry.teacher_id,
                    "teacher_name": entry.teacher.name,
                    "count": 0,
                    "duration_minutes": 0,
                },
            )
            bucket["count"] += 1
            bucket["duration_minutes"] += entry.duration_minutes

        return Response(
            {
                "count": len(entries),
                "duration_minutes": sum(e.duration_minutes for e in entries),
                "by_type": by_type,
                "by_day": [
                    {"entry_date": day, "duration_minutes": minutes}
                    for day, minutes in sorted(by_day.items())
                ],
                "per_teacher": sorted(
                    per_teacher.values(),
                    key=lambda row: -row["duration_minutes"],
                ),
            }
        )


class TimesheetExportView(APIView):
    """GET /api/timesheet/export/ — server-backed .xlsx of the approved ledger.

    Admin-only. Exports only CONFIRMED entries (the approved, countable hours)
    with the same date/type/teacher filters as the list endpoint.
    """

    permission_classes = [IsAdminUser]

    def get(self, request):
        queryset = _apply_filters(
            request, _timesheet_scope(request, _base_timesheet_queryset())
        ).filter(status=TimesheetEntryStatus.CONFIRMED)
        entries = list(queryset.order_by("entry_date", "start_time"))
        return _xlsx_download(
            _export_workbook_bytes(entries), TIMESHEET_EXPORT_FILENAME
        )