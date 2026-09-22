from django.urls import path

from apps.imports.views import (
    ImportExportView,
    ImportPreviewView,
    ImportSessionListView,
    ImportTemplateView,
    StudentImportConfirmView,
    TeacherImportConfirmView,
)

urlpatterns = [
    path(
        "imports/<str:kind>/preview/",
        ImportPreviewView.as_view(),
        name="import-preview",
    ),
    path(
        "imports/<str:kind>/template/",
        ImportTemplateView.as_view(),
        name="import-template",
    ),
    path(
        "imports/<str:kind>/export/",
        ImportExportView.as_view(),
        name="import-export",
    ),
    path(
        "imports/<str:kind>/",
        ImportSessionListView.as_view(),
        name="import-session-list",
    ),
    path(
        "imports/students/confirm/",
        StudentImportConfirmView.as_view(),
        name="student-import-confirm",
    ),
    path(
        "imports/teachers/confirm/",
        TeacherImportConfirmView.as_view(),
        name="teacher-import-confirm",
    ),
]