from django.urls import path

from rest_framework.routers import DefaultRouter

from apps.timesheet.views import (
    TimesheetEntryViewSet,
    TimesheetExportView,
    TimesheetSummaryView,
)

router = DefaultRouter()
router.register("entries", TimesheetEntryViewSet, basename="timesheet-entry")

urlpatterns = [
    *router.urls,
    path("summary/", TimesheetSummaryView.as_view(), name="timesheet-summary"),
    path("export/", TimesheetExportView.as_view(), name="timesheet-export"),
]