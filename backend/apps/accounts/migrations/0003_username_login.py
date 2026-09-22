import re

from django.db import migrations, models


def _sanitize(value):
    """Deterministic username handle from an email local-part."""
    base = re.sub(r"[^a-zA-Z0-9@.+_-]", "", (value or "").split("@")[0]).strip(".")
    return base or "user"


def backfill_username(apps, schema_editor):
    """Backfill usernames from linked profiles (student/teacher ID) or email.

    A student's username is their college-issued ``student_id``, a teacher's is
    their ``teacher_id``, and unlinked accounts (e.g. the seeded admin) get a
    stable handle derived from their email. Collisions or blanks are resolved
    with a numeric suffix so the unique constraint never fails.
    """
    User = apps.get_model("accounts", "User")
    used = set()
    for user in User.objects.all().order_by("id"):
        username = ""
        if user.student_profile_id:
            username = user.student_profile.student_id or ""
        if not username and user.teacher_profile_id:
            username = user.teacher_profile.teacher_id or ""
        if not username:
            username = _sanitize(user.email)

        candidate = username
        suffix = 2
        while candidate in used or User.objects.filter(username=candidate).exists():
            candidate = f"{username}{suffix}"
            suffix += 1

        user.username = candidate
        used.add(candidate)
        user.save(update_fields=["username"])


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_expiringtoken"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="username",
            field=models.CharField(max_length=150, null=True),
        ),
        migrations.RunPython(backfill_username, reverse_code=migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="username",
            field=models.CharField(max_length=150, unique=True),
        ),
    ]