from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone

from rest_framework.authtoken.models import Token

from apps.accounts.managers import UserManager


class Role(models.TextChoices):
    ADMIN = "admin", "Admin"
    TEACHER = "teacher", "Teacher"
    STUDENT = "student", "Student"


class User(AbstractUser):
    """Username-based AAMS user with role-based access control.

    Authentication is by ``username`` — for students this is their
    college-issued student ID (e.g. ``std-1``), for teachers their staff code,
    and for admins a staff handle. ``email`` remains the unique institutional
    contact. A teacher/student profile is linked through optional OneToOne
    relations, preserving the frontend's ``teacherId`` / ``studentId``
    convenience references without duplicating them.
    """

    username = models.CharField(max_length=150, unique=True)
    email = models.EmailField("email address", unique=True)
    name = models.CharField(max_length=150, blank=True)
    role = models.CharField(
        max_length=20, choices=Role.choices, default=Role.STUDENT
    )
    avatar = models.URLField(blank=True)
    department = models.CharField(max_length=200, blank=True)

    # Identity/password lifecycle (Phase D). True for accounts provisioned by
    # an institutional import (or reset by an admin) until the holder replaces
    # the temporary password through POST /api/auth/password/change/. The
    # master-record status (Student/Teacher.status) and User.is_active are
    # deliberately independent concerns; this flag only gates the password
    # lifecycle, never account enable/disable.
    must_change_password = models.BooleanField(default=False)

    teacher_profile = models.OneToOneField(
        "teachers.Teacher",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="user_account",
    )
    student_profile = models.OneToOneField(
        "students.Student",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="user_account",
    )

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["email"]

    objects = UserManager()

    class Meta:
        ordering = ["email"]

    def __str__(self):
        return self.name or self.email

    @property
    def is_teacher(self) -> bool:
        return self.role == Role.TEACHER

    @property
    def is_student(self) -> bool:
        return self.role == Role.STUDENT


class ExpiringToken(Token):
    """DRF Token with an explicit expiration timestamp.

    ``expires_at`` is ``NULL`` only when the configured lifetime is ``0``
    (local development convenience). In production the operator must set
    ``AAMS_TOKEN_TTL_SECONDS`` to a positive value.

    Issuance/validation stay centralized here and in
    ``apps.accounts.authentication.ExpiringTokenAuthentication`` so every
    endpoint relies on the same lifecycle rules without duplicating them.
    """

    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "expiring token"

    @property
    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        return timezone.now() >= self.expires_at

    @classmethod
    def lifetime_seconds(cls) -> int:
        """Configured token lifetime, read fresh from settings each call so
        ``override_settings`` (tests) and runtime env changes apply."""
        try:
            return max(int(getattr(settings, "AAMS_TOKEN_TTL_SECONDS", 0) or 0), 0)
        except (TypeError, ValueError):
            return 0

    @classmethod
    def issue_for(cls, user):
        """Return the user's current unexpired token or mint a fresh one.

        Keeps a single live token per user (reused across requests until it
        expires). Anything else — an expired token row or an orphaned legacy
        parent ``Token`` (a user who authenticated before expiring tokens
        existed) — is reclaimed first, otherwise the unique parent constraint
        ``authtoken_token_user_id_key`` would reject the insert.
        """
        ttl = cls.lifetime_seconds()
        existing = cls.objects.filter(user=user).first()
        if existing and not existing.is_expired:
            return existing
        # Deleting the parent Token row cascades to the linked child
        # ExpiringToken, so a single delete covers both cases above.
        Token.objects.filter(user=user).delete()
        expires_at = None
        if ttl:
            expires_at = timezone.now() + timedelta(seconds=ttl)
        return cls.objects.create(user=user, expires_at=expires_at)