"""Root URL configuration for the AAMS backend."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/academics/", include("apps.academics.urls")),
    path("api/teachers/", include("apps.teachers.urls")),
    path("api/students/", include("apps.students.urls")),
    path("api/attendance/", include("apps.attendance.urls")),
    path("api/timesheet/", include("apps.timesheet.urls")),
    path("api/reports/", include("apps.reports.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
    path("api/", include("apps.imports.urls")),
    path("api/", include("apps.common.urls")),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)