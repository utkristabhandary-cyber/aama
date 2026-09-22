from django.urls import path

from apps.reports.views import admin_dashboard, by_subject, summary

urlpatterns = [
    path("summary/", summary, name="report-summary"),
    path("admin/", admin_dashboard, name="report-admin-dashboard"),
    path("by-subject/", by_subject, name="report-by-subject"),
]