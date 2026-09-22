import secrets

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from apps.academics.models import Section, TeachingSession
from apps.teachers.models import Teacher


class AttendancePhase(models.TextChoices):
    MANUAL = "manual", "Manual"
    QR = "qr", "QR"


class AttendanceStatus(models.TextChoices):
    PRESENT = "present", "Present"
    ABSENT = "absent", "Absent"
    LATE = "late", "Late"


def _format_token() -> str:
    """Return an 8-character QR token shaped like the frontend (e.g. 8F3K-29PA)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    def part() -> str:
        return "".join(secrets.choice(alphabet) for _ in range(4))

    return f"{part()}-{part()}"


def generate_token() -> str:
    return _format_token()


class AttendanceSession(models.Model):
    """A class session for which attendance is recorded.

    ``teaching_session`` is nullable until the session is linked, so records can be
    collected during the live class before finalization (mirrors the frontend flow).
    Credited status is authoritative; ``is_auto_present`` is always False — an unmarked
    student has no AttendanceRecord and counts as UNMARKED, never Present.
    """

    session_date = models.DateField()
    subject = models.ForeignKey(
        "academics.Subject",
        on_delete=models.PROTECT,
        related_name="attendance_sessions",
    )
    teacher = models.ForeignKey(
        Teacher, on_delete=models.PROTECT, related_name="attendance_sessions"
    )
    phase = models.CharField(
        max_length=20, choices=AttendancePhase.choices, default=AttendancePhase.MANUAL
    )
    start_time = models.TimeField()
    planned_end_time = models.TimeField()
    end_time = models.TimeField(blank=True, null=True)
    sections = models.ManyToManyField(Section, related_name="attendance_sessions")
    teaching_session = models.ForeignKey(
        TeachingSession,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="attendance_sessions",
    )
    attendance_ids = models.JSONField(default=list, blank=True)
    marked_ids = models.JSONField(default=list, blank=True)
    late_reason = models.CharField(max_length=300, blank=True)
    is_auto_present = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="+",
    )
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    submitted_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-session_date", "start_time"]

    def __str__(self):
        return f"{self.subject} on {self.session_date}"

    @property
    def is_finalized(self) -> bool:
        return self.submitted_at is not None

    def clean(self):
        super().clean()
        if self.planned_end_time and self.start_time >= self.planned_end_time:
            raise ValidationError(
                {"planned_end_time": "End time must be after start time."}
            )


class AttendanceRecord(models.Model):
    """A single student's mark inside an attendance session.

    Absence of a record means UNMARKED. Marking happens in two steps:
    ``marking_complete`` (marked) followed by ``marking`` (Present/Absent/Late),
    mirroring the frontend attendance flow.
    """

    attendance_session = models.ForeignKey(
        AttendanceSession,
        on_delete=models.CASCADE,
        related_name="attendance_records",
    )
    student = models.ForeignKey(
        "students.Student", on_delete=models.CASCADE, related_name="attendance_records"
    )
    status = models.CharField(
        max_length=20, choices=AttendanceStatus.choices, default=AttendanceStatus.LATE
    )
    marking = models.BooleanField(default=False)
    marking_complete = models.BooleanField(default=False)
    submitted_at = models.DateTimeField(blank=True, null=True)

    # QR check-in evidence. `checked_in_at` is the moment the student's camera
    # scan was accepted; the network field honestly records that this web-only
    # application cannot attest the client's network, so it is always
    # "unavailable" (see services.check_in_student).
    checked_in_at = models.DateTimeField(blank=True, null=True)
    network_verification_method = models.CharField(
        max_length=32,
        choices=[
            ("unavailable", "Unavailable"),
        ],
        default="unavailable",
    )

    class Meta:
        ordering = ["student__roll_no"]
        constraints = [
            models.UniqueConstraint(
                fields=["attendance_session", "student"],
                name="uniq_attendance_record_per_session_student",
            )
        ]

    def __str__(self):
        return f"{self.student} -> {self.status}"


class QRAttendanceSession(models.Model):
    """QR code attendance flow: one active session per teacher at a time.

    Payload is ``AAMSQR1|<attendance_session_id>|<TOKEN>``; the token rotates every
    ``AAMS_QR_TOKEN_TTL_SECONDS`` (default 15s). The token is generated with
    ``secrets`` on the server and is the ONLY thing the student needs to check
    in — the identity is always ``request.user.student_profile``, never a value
    shipped from the client.
    """

    # Documented default; the ACTIVE value is read from settings at request
    # time in get_current_token() so environments/tests can tune it.
    TTL_SECONDS = 15

    teacher = models.ForeignKey(
        Teacher, on_delete=models.CASCADE, related_name="qr_sessions"
    )
    attendance_session = models.ForeignKey(
        AttendanceSession, on_delete=models.CASCADE, related_name="qr_sessions"
    )
    token = models.CharField(max_length=32)
    token_generated_at = models.DateTimeField(auto_now_add=True)
    student_ids = models.JSONField(default=list, blank=True)
    student_timestamps = models.JSONField(default=dict, blank=True)
    revoked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher"],
                condition=models.Q(revoked=False),
                name="uniq_active_qr_session_per_teacher",
            )
        ]

    def __str__(self):
        return f"QR {self.token} for {self.attendance_session}"

    def rotate(self) -> str:
        self.token = generate_token()
        self.token_generated_at = timezone.now()
        self.save(update_fields=["token", "token_generated_at"])
        return self.token

    def get_current_token(self) -> str:
        ttl_seconds = getattr(
            settings, "AAMS_QR_TOKEN_TTL_SECONDS", self.TTL_SECONDS
        )
        if (timezone.now() - self.token_generated_at).total_seconds() > ttl_seconds:
            return self.rotate()
        return self.token