import uuid

from django.conf import settings
from django.db import models


class SemesterStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    UPCOMING = "upcoming", "Upcoming"
    COMPLETED = "completed", "Completed"


class SubjectType(models.TextChoices):
    LECTURE = "Lecture", "Lecture"
    TUTORIAL = "Tutorial", "Tutorial"
    PRACTICAL = "Practical", "Practical"


class SubjectStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"


class TeacherStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"


class StudentStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    GRADUATED = "graduated", "Graduated"
    INACTIVE = "inactive", "Inactive"


class AssignmentStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"


class DayOfWeek(models.TextChoices):
    SUNDAY = "Sunday", "Sunday"
    MONDAY = "Monday", "Monday"
    TUESDAY = "Tuesday", "Tuesday"
    WEDNESDAY = "Wednesday", "Wednesday"
    THURSDAY = "Thursday", "Thursday"
    FRIDAY = "Friday", "Friday"


class HolidayType(models.TextChoices):
    INSTITUTIONAL = "institutional", "Institutional"
    NATIONAL = "national", "National"
    FESTIVAL = "festival", "Festival"
    RESTRICTED = "restricted", "Restricted"
    EMERGENCY = "emergency", "Emergency"


class Semester(models.Model):
    """Academic term — the root of the academic hierarchy."""

    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, unique=True)
    academic_year = models.CharField(max_length=20)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(
        max_length=20, choices=SemesterStatus.choices, default=SemesterStatus.UPCOMING
    )
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.code} ({self.academic_year})"

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValidationError({"end_date": "End date cannot be before start date."})


class Section(models.Model):
    """A class group inside a semester (e.g. Section A of SEM1-2026)."""

    name = models.CharField(max_length=100)
    semester = models.ForeignKey(
        Semester, on_delete=models.CASCADE, related_name="sections"
    )
    capacity = models.PositiveIntegerField(default=35)
    room = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["semester__code", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["semester", "name"], name="uniq_section_name_per_semester"
            )
        ]

    def __str__(self):
        return f"{self.semester.code} · {self.name}"


class Subject(models.Model):
    """A subject/module offered within a semester."""

    code = models.CharField(max_length=20)
    name = models.CharField(max_length=200)
    semester = models.ForeignKey(
        Semester, on_delete=models.CASCADE, related_name="subjects"
    )
    credits = models.PositiveIntegerField(default=3)
    type = models.CharField(
        max_length=20, choices=SubjectType.choices, default=SubjectType.LECTURE
    )
    status = models.CharField(
        max_length=20, choices=SubjectStatus.choices, default=SubjectStatus.ACTIVE
    )

    class Meta:
        ordering = ["code"]
        constraints = [
            models.UniqueConstraint(
                fields=["semester", "code"], name="uniq_subject_code_per_semester"
            )
        ]

    def __str__(self):
        return f"{self.code} · {self.name}"


class Holiday(models.Model):
    date = models.DateField()
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    type = models.CharField(
        max_length=20, choices=HolidayType.choices, default=HolidayType.INSTITUTIONAL
    )

    class Meta:
        ordering = ["date"]

    def __str__(self):
        return self.title


class TeacherAssignment(models.Model):
    """Links a teacher to a subject for a specific section within a semester.

    Mirrors the frontend ``TeacherAssignment``. The single-module-per-semester
    rule is enforced by ``apps.academics.services`` (an assignment with a
    *different* subject for an already-assigned teacher in the same semester is
    rejected), matching the frontend's ``assertTeacherSingleModulePerSemester``.
    """

    teacher = models.ForeignKey(
        "teachers.Teacher", on_delete=models.CASCADE, related_name="assignments"
    )
    semester = models.ForeignKey(
        Semester, on_delete=models.CASCADE, related_name="teacher_assignments"
    )
    section = models.ForeignKey(
        Section, on_delete=models.CASCADE, related_name="teacher_assignments"
    )
    subject = models.ForeignKey(
        Subject, on_delete=models.CASCADE, related_name="teacher_assignments"
    )
    status = models.CharField(
        max_length=20, choices=AssignmentStatus.choices, default=AssignmentStatus.ACTIVE
    )
    created_at = models.DateField(auto_now_add=True)

    class Meta:
        ordering = ["semester__code", "section__name", "subject__code"]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "semester", "section", "subject"],
                name="uniq_assignment_teacher_semester_section_subject",
            )
        ]

    def __str__(self):
        return f"{self.teacher} → {self.subject} ({self.section})"

    def clean(self):
        from django.core.exceptions import ValidationError

        errors = {}
        if self.subject_id and self.semester_id and self.subject.semester_id != self.semester_id:
            errors["subject"] = "Subject does not belong to the selected semester."
        if self.section_id and self.semester_id and self.section.semester_id != self.semester_id:
            errors["section"] = "Section does not belong to the selected semester."
        if errors:
            raise ValidationError(errors)


class TimetableSlot(models.Model):
    """A scheduled class slot; supports combined-section sessions.

    ``section`` is the primary/default section; ``sections`` (M2M) holds every
    participating section for combined lectures (mirrors frontend ``sectionIds``
    + ``isCombined``). ``is_combined`` is derived from the participating
    sections (len > 1) exactly as the frontend normalizes it.
    """

    semester = models.ForeignKey(
        Semester, on_delete=models.CASCADE, related_name="timetable_slots"
    )
    section = models.ForeignKey(
        Section, on_delete=models.CASCADE, related_name="timetable_slots"
    )
    sections = models.ManyToManyField(
        Section, related_name="timetable_slot_memberships", blank=True
    )
    subject = models.ForeignKey(
        Subject, on_delete=models.CASCADE, related_name="timetable_slots"
    )
    teacher = models.ForeignKey(
        "teachers.Teacher", on_delete=models.CASCADE, related_name="timetable_slots"
    )
    day = models.CharField(max_length=20, choices=DayOfWeek.choices)
    start_time = models.TimeField()
    end_time = models.TimeField()
    room = models.CharField(max_length=200, blank=True)
    class_type = models.CharField(
        max_length=20, choices=SubjectType.choices, default=SubjectType.LECTURE
    )
    notes = models.TextField(blank=True)
    is_combined = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["day", "start_time"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_time__gt=models.F("start_time")),
                name="check_timetable_end_after_start",
            )
        ]

    def __str__(self):
        return f"{self.subject.code} · {self.day} {self.start_time:%H:%M} ({self.teacher})"

    @property
    def section_ids(self):
        return list(self.sections.values_list("id", flat=True))


class TeachingSession(models.Model):
    """A recurring teaching block a teacher owns, supporting combined lectures.

    Mirrors the frontend ``TeachingSession`` used by the teacher dashboard and
    QR roll-call flows. ``sectionIds``/``isCombined`` are expressed through the
    ``sections`` M2M and derived ``is_combined``.
    """

    semester = models.ForeignKey(
        Semester, on_delete=models.CASCADE, related_name="teaching_sessions"
    )
    subject = models.ForeignKey(
        Subject, on_delete=models.CASCADE, related_name="teaching_sessions"
    )
    teacher = models.ForeignKey(
        "teachers.Teacher", on_delete=models.CASCADE, related_name="teaching_sessions"
    )
    class_type = models.CharField(
        max_length=20, choices=SubjectType.choices, default=SubjectType.LECTURE
    )
    sections = models.ManyToManyField(
        Section, related_name="teaching_sessions", blank=True
    )
    is_combined = models.BooleanField(default=False)
    day = models.CharField(
        max_length=20, choices=DayOfWeek.choices, blank=True
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    room = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["day", "start_time"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_time__gt=models.F("start_time")),
                name="check_teaching_end_after_start",
            )
        ]

    def __str__(self):
        return f"{self.subject.code} · {self.class_type} ({self.teacher})"

    @property
    def section_ids(self):
        return list(self.sections.values_list("id", flat=True))


class TimetableImportSession(models.Model):
    """A validated Excel timetable import, staged for admin confirmation.

    ``parsed_rows`` is the server-side, normalized representation of the
    uploaded workbook (never raw client input). The confirm endpoint
    re-validates and re-matches every row against the current database before
    committing, so a stale session can never silently write wrong data.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"

    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="timetable_imports",
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
        return f"{self.file_name} ({self.uuid})"