from rest_framework.routers import DefaultRouter

from apps.academics.views import (
    HolidayViewSet,
    SectionViewSet,
    SemesterViewSet,
    SubjectViewSet,
    TeacherAssignmentViewSet,
    TeachingSessionViewSet,
    TimetableImportViewSet,
    TimetableViewSet,
)

router = DefaultRouter()
router.register(r"semesters", SemesterViewSet, basename="semester")
router.register(r"sections", SectionViewSet, basename="section")
router.register(r"subjects", SubjectViewSet, basename="subject")
router.register(r"assignments", TeacherAssignmentViewSet, basename="assignment")
router.register(r"timetable", TimetableViewSet, basename="timetable-slot")
router.register(r"timetable-import", TimetableImportViewSet, basename="timetable-import")
router.register(r"teaching-sessions", TeachingSessionViewSet, basename="teaching-session")
router.register(r"holidays", HolidayViewSet, basename="holiday")

urlpatterns = router.urls