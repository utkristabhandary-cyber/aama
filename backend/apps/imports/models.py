"""Generic institutional Excel import sessions (Phase A).

Mirrors ``TimetableImportSession`` (apps/academics/models.py) but is
kind-agnostic: a single staging model holds server-produced ``parsed_rows`` +
``summary`` for any institutional import kind (``students``, ``teachers``).

Phase A rules this line defends:
- ``parsed_rows`` is the server-side, normalized view of the workbook — never
  raw client input.
- Upload/preview never touches authoritative tables; the session only proves a
  workbook was parsed, normalized and classified.
- Sessions are owner-scoped (``created_by``), admin-only, pending until a future
  phase implements the explicit-confirm commit.
"""
import uuid

from django.conf import settings
from django.db import models


class ImportKind(models.TextChoices):
    STUDENTS = "students", "Students"
    TEACHERS = "teachers", "Teachers"


class ImportSession(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"

    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    kind = models.CharField(max_length=20, choices=ImportKind.choices)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="import_sessions",
    )
    file_name = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField()
    sheet_name = models.CharField(max_length=255, blank=True)
    sheet_count = models.PositiveIntegerField(default=1)
    total_rows = models.PositiveIntegerField(default=0)
    parsed_rows = models.JSONField(default=list)
    summary = models.JSONField(default=dict)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.kind}: {self.file_name} ({self.uuid})"