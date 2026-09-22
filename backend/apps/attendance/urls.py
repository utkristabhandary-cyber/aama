from rest_framework.routers import DefaultRouter

from apps.attendance.views import (
    AttendanceRecordViewSet,
    AttendanceSessionViewSet,
    QRAttendanceSessionViewSet,
)

router = DefaultRouter()
router.register(r"sessions", AttendanceSessionViewSet, basename="attendance-session")
router.register(r"records", AttendanceRecordViewSet, basename="attendance-record")
router.register(r"qr", QRAttendanceSessionViewSet, basename="qr-session")

urlpatterns = router.urls