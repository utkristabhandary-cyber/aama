from django.db import models

from apps.academics.models import TeacherStatus


class Teacher(models.Model):
    """Faculty profile. May be linked to a ``User`` account."""

    teacher_id = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=150)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=30, blank=True)
    department = models.CharField(max_length=200, blank=True)
    designation = models.CharField(max_length=150, blank=True)
    qualification = models.CharField(max_length=200, blank=True)
    avatar = models.URLField(blank=True)
    status = models.CharField(
        max_length=20, choices=TeacherStatus.choices, default=TeacherStatus.ACTIVE
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name