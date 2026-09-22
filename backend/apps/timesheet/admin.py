from django.contrib import admin

from .models import TimesheetEntry


@admin.register(TimesheetEntry)
class TimesheetEntryAdmin(admin.ModelAdmin):
    list_display = (
        "teacher",
        "entry_date",
        "type",
        "start_time",
        "end_time",
        "duration_minutes",
        "status",
    )
    list_filter = ("status", "type", "entry_date")
    search_fields = ("teacher__name", "teacher__teacher_id", "note")
    date_hierarchy = "entry_date"
    filter_horizontal = ("sections",)