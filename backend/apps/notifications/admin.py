from django.contrib import admin

from apps.notifications.models import Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("recipient", "title", "notification_type", "is_read", "created_at")
    list_filter = ("is_read", "notification_type")
    search_fields = ("recipient__email", "title")