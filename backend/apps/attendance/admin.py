from django.contrib import admin

from apps.attendance.models import (
    AttendanceRecord,
    AttendanceSession,
    QRAttendanceSession,
)


class AttendanceRecordInline(admin.TabularInline):
    model = AttendanceRecord
    extra = 0


@admin.register(AttendanceSession)
class AttendanceSessionAdmin(admin.ModelAdmin):
    list_display = (
        "subject",
        "teacher",
        "session_date",
        "phase",
        "start_time",
        "planned_end_time",
        "submitted_at",
    )
    list_filter = ("phase", "session_date")
    search_fields = ("subject__name", "subject__code", "teacher__name")
    filter_horizontal = ("sections",)
    inlines = [AttendanceRecordInline]


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ("attendance_session", "student", "status", "marking_complete")
    list_filter = ("status",)
    search_fields = ("student__name", "student__roll_no")


@admin.register(QRAttendanceSession)
class QRAttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ("teacher", "attendance_session", "token", "revoked", "created_at")
    list_filter = ("revoked",)