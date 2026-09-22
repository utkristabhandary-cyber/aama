from django.contrib import admin

from apps.imports.models import ImportSession


@admin.register(ImportSession)
class ImportSessionAdmin(admin.ModelAdmin):
    list_display = ("uuid", "kind", "file_name", "total_rows", "status", "created_by", "created_at")
    list_filter = ("kind", "status")
    search_fields = ("uuid", "file_name", "created_by__username")
    readonly_fields = ("uuid", "created_at", "confirmed_at")