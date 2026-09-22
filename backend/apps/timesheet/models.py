from datetime import datetime

from django.conf import settings
from django.db import models


class TimesheetEntryType(models.TextChoices):
    CLASS = "class", "Class"
    DUTY = "duty", "Duty"
    OTHER = "other", "Other"


class TimesheetEntryStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SUBMITTED = "submitted", "Submitted"
    CONFIRMED = "confirmed", "Confirmed"
    REJECTED = "rejected", "Rejected"


class TimesheetEntry(models.Model):
    """A single day's worked-hours entry a teacher logs on their timesheet.

    AAMS has no payroll / clock-in product; this model is the institutional
    work/duty-hours log a teacher fills in each day (classes delivered and
    non-teaching duties). The server derives ``duration_minutes`` from
    ``start_time``/``end_time`` — a client-supplied duration is never trusted.

    It is deliberately NOT a parallel attendance system: it creates no
    AttendanceSession, no TimetableSlot and no TeachingSession. ``subject`` /
    ``sections`` on a class entry only reference existing academic structure.
    """

    teacher = models.ForeignKey(
        "teachers.Teacher", on_delete=models.CASCADE, related_name="timesheet_entries"
    )
    entry_date = models.DateField()
    type = models.CharField(
        max_length=20,
        choices=TimesheetEntryType.choices,
        default=TimesheetEntryType.CLASS,
    )
    subject = models.ForeignKey(
        "academics.Subject",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="timesheet_entries",
    )
    sections = models.ManyToManyField(
        "academics.Section", blank=True, related_name="timesheet_entries"
    )
    semester = models.ForeignKey(
        "academics.Semester",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="timesheet_entries",
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    note = models.CharField(max_length=500, blank=True)
    status = models.CharField(
        max_length=20,
        choices=TimesheetEntryStatus.choices,
        default=TimesheetEntryStatus.DRAFT,
    )
    rejection_reason = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-entry_date", "start_time"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_time__gt=models.F("start_time")),
                name="check_timesheet_end_after_start",
            )
        ]

    def __str__(self):
        return f"{self.teacher} · {self.entry_date} {self.start_time:%H:%M}"

    @property
    def duration_minutes(self) -> int:
        """Whole minutes between ``start_time`` (inclusive) and ``end_time``.

        Computed on a fixed reference date; the model enforces
        ``end_time > start_time`` so the result is always positive.
        """
        if not self.start_time or not self.end_time:
            return 0
        anchor = datetime(2000, 1, 1)
        start = datetime.combine(anchor.date(), self.start_time)
        end = datetime.combine(anchor.date(), self.end_time)
        return int((end - start).total_seconds() // 60)