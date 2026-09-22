from django.contrib import admin

from apps.teachers.models import Teacher


@admin.register(Teacher)
class TeacherAdmin(admin.ModelAdmin):
    list_display = (
        "teacher_id",
        "name",
        "email",
        "department",
        "designation",
        "status",
    )
    list_filter = ("status", "department")
    search_fields = ("name", "email", "teacher_id")