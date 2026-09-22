from django.contrib import admin

from apps.academics.models import (
    Holiday,
    Section,
    Semester,
    Subject,
    TeacherAssignment,
    TeachingSession,
    TimetableSlot,
)


@admin.register(Semester)
class SemesterAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "academic_year", "start_date", "end_date", "status")
    list_filter = ("status", "academic_year")
    search_fields = ("code", "name")


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = ("name", "semester", "capacity", "room")
    list_filter = ("semester",)
    search_fields = ("name",)


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "semester", "credits", "type", "status")
    list_filter = ("semester", "type", "status")
    search_fields = ("code", "name")


@admin.register(TeacherAssignment)
class TeacherAssignmentAdmin(admin.ModelAdmin):
    list_display = ("teacher", "subject", "section", "semester", "status")
    list_filter = ("semester", "status")
    search_fields = ("teacher__name", "subject__name", "subject__code")


@admin.register(TimetableSlot)
class TimetableSlotAdmin(admin.ModelAdmin):
    list_display = (
        "subject",
        "teacher",
        "section",
        "day",
        "start_time",
        "end_time",
        "room",
        "class_type",
        "is_combined",
    )
    list_filter = ("day", "semester", "class_type", "is_combined")
    search_fields = ("subject__name", "subject__code", "teacher__name", "room")
    filter_horizontal = ("sections",)


@admin.register(TeachingSession)
class TeachingSessionAdmin(admin.ModelAdmin):
    list_display = (
        "subject",
        "teacher",
        "class_type",
        "day",
        "start_time",
        "end_time",
        "room",
        "is_combined",
    )
    list_filter = ("semester", "class_type", "is_combined")
    search_fields = ("subject__name", "subject__code", "teacher__name")
    filter_horizontal = ("sections",)


@admin.register(Holiday)
class HolidayAdmin(admin.ModelAdmin):
    list_display = ("date", "title", "type")
    list_filter = ("type",)
    search_fields = ("title",)