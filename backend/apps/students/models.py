from django.core.exceptions import ValidationError
from django.db import models

from apps.academics.models import DayOfWeek, Section, Semester, StudentStatus


class Student(models.Model):
    """Student profile. May be linked to a ``User`` account."""

    student_id = models.CharField(max_length=30, unique=True)
    roll_no = models.CharField(max_length=30)
    name = models.CharField(max_length=150)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=30, blank=True)
    section = models.ForeignKey(
        Section, on_delete=models.SET_NULL, null=True, blank=True, related_name="students"
    )
    semester = models.ForeignKey(
        Semester,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="students",
    )
    avatar = models.URLField(blank=True)
    admission_year = models.PositiveIntegerField(blank=True, null=True)
    dob = models.DateField(blank=True, null=True)
    address = models.TextField(blank=True)
    guardian_name = models.CharField(max_length=150, blank=True)
    guardian_phone = models.CharField(max_length=30, blank=True)
    status = models.CharField(
        max_length=20, choices=StudentStatus.choices, default=StudentStatus.ACTIVE
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def clean(self):
        super().clean()
        if (
            self.section_id
            and self.semester_id
            and self.section.semester_id != self.semester_id
        ):
            raise ValidationError(
                {"section": "Section and semester must refer to the same semester."}
            )


# Pseudo-day labels used by bulk import (kept in sync with frontend).
DAILY_SCHEDULE_DAYS = DayOfWeek.values