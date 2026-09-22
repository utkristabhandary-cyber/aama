import re

from django.contrib.auth.models import BaseUserManager


class UserManager(BaseUserManager):
    """Manager for the custom username-based AAMS User model.

    ``username`` is the primary login identifier. Legacy callers that predate
    username authentication may omit it; a stable handle is then derived
    deterministically from the email local-part (never from a "first record"),
    so every account always has an explicit, repeatable login identity.
    """

    use_in_migrations = True

    @staticmethod
    def _derive_username(email):
        """Deterministic handle from an email local-part, uniquified if needed."""
        base = re.sub(r"[^a-zA-Z0-9@.+_-]", "", (email or "").split("@")[0]).strip(".")
        return base or "user"

    def _create_user(self, username, email, password, **extra_fields):
        if not email:
            raise ValueError("Users must provide an email address.")
        email = self.normalize_email(email)
        if not username:
            raise ValueError("Users must provide a username.")
        username = self.model.normalize_username(username)
        user = self.model(username=username, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, username=None, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        if not username:
            username = self._new_unique_username(email)
        return self._create_user(username, email, password, **extra_fields)

    def create_superuser(self, username=None, email=None, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("role", "admin")
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        if not username:
            username = self._new_unique_username(email)
        user = self._create_user(username, email, password, **extra_fields)
        user.is_staff = True
        user.is_superuser = True
        user.save(using=self._db)
        return user

    def _new_unique_username(self, email):
        """Derive a unique username from ``email`` for legacy callers."""
        base = self._derive_username(email)
        username = base
        suffix = 2
        while self.model.objects.filter(username=username).exists():
            username = f"{base}{suffix}"
            suffix += 1
        return username