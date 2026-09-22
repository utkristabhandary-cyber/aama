from django.contrib import admin

from apps.students.models import Student


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = (
        "student_id",
        "roll_no",
        "name",
        "email",
        "section",
        "semester",
        "status",
    )
    list_filter = ("status", "section", "semester")
    search_fields = ("name", "email", "student_id", "roll_no")