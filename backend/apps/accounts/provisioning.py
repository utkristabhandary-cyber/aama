"""Account provisioning + identity/password lifecycle (Phase D).

All account creation happens ONLY inside an explicitly confirmed
institutional import transaction — never on upload/preview/review. This
module owns the deterministic rules:

- username == institutional ID (``Student.student_id`` / ``Teacher.teacher_id``)
- role derived from the kind (student | teacher)
- initial temporary password == ``<ID>@123``, hashed via ``set_password``
- ``must_change_password = True`` for every freshly provisioned account
- eligibility: only ACTIVE master records get a login; inactive/graduated
  master rows never auto-create an account
- re-import safety: an existing linked account is preserved (username,
  password, ``must_change_password``, is_active all untouched)
- identity namespace is global: an institutional ID already used as another
  account's username is a conflict (never a second User, never a rename)

Password policy note (per docs/25 §8 + §16): bootstrap temporary passwords are
generated server-side and passed straight to ``User.set_password`` — they
deliberately bypass ``django.contrib.auth.password_validation`` (which runs at
serializer/form level). They are never returned, logged, stored in the import
session, or rendered. The password-change endpoint enforces every configured
validator for user-established passwords, so the global policy is never
weakened — the bootstrap step is simply a documented, narrow exemption.

Security invariant: after this module runs the returned password hash lives
only inside the ``User`` row. No caller here ever persists or serializes the
plaintext.
"""
from django.contrib.auth import get_user_model

from apps.academics.models import StudentStatus, TeacherStatus
from apps.accounts.models import Role

User = get_user_model()

# Deterministic documented bootstrap-password rule: <institutional ID>@123.
INITIAL_PASSWORD_SUFFIX = "@123"

# ---------------------------------------------------------------------------
# Account-plan action vocabulary (mirrors the master `plan` vocabulary style)
# ---------------------------------------------------------------------------

ACTION_PROVISION = "provision"            # a new User will be created
ACTION_ACCOUNT_EXISTS = "account_exists"  # already linked to a User; untouched
ACTION_NO_ACCOUNT = "no_account"          # master only (inactive/graduated)
ACTION_CONFLICT = "account_conflict"      # username/identity collision -> blocks
ACTION_ERROR = "error"                    # row already blocked by master plan


def initial_password(institutional_id: str) -> str:
    """Server-side bootstrap password for an institutional ID.

    Caller must hand the result immediately to ``set_password`` (or a hash
    operation). It is a GENERATED credential, never stored/returned/logged.
    """
    return f"{institutional_id}{INITIAL_PASSWORD_SUFFIX}"


def role_for(kind: str):
    return Role.STUDENT if kind == "students" else Role.TEACHER


def username_for(institutional_id: str) -> str:
    """Canonical login username == normalized institutional ID."""
    return User.normalize_username((institutional_id or "").strip())


def active_status_for(kind: str):
    return StudentStatus.ACTIVE if kind == "students" else TeacherStatus.ACTIVE


def account_eligible(status, kind: str) -> bool:
    """Only ACTIVE master records are eligible for a login account."""
    return status == active_status_for(kind)


def index_users(users=None):
    """Return ``(users_by_username, users_by_teacher, users_by_student)``.

    ``users_by_username`` maps the casefolded username -> User (used for
    cross-type identity-collision checks). ``users_by_teacher`` /
    ``users_by_student`` map profile pk -> User for resolution of the
    OneToOne master<->account link without N+1 queries.
    """
    if users is None:
        users = list(
            User.objects.select_related("teacher_profile", "student_profile")
        )
    by_username = {}
    by_teacher = {}
    by_student = {}
    for u in users:
        if u.username:
            by_username[u.username.casefold()] = u
        if u.teacher_profile_id:
            by_teacher[u.teacher_profile_id] = u
        if u.student_profile_id:
            by_student[u.student_profile_id] = u
    return by_username, by_teacher, by_student


def compute_account_action(kind, institutional_id, effective_status,
                           linked_user, users_by_username):
    """Decide the account consequence for one imported row.

    Returns ``(action, username, message)`` — everything is safe for the
    admin preview (no passwords, no hashes). ``action`` is one of the
    ``ACTION_*`` constants. A username already held by a *different* account
    is ``ACTION_CONFLICT`` (the caller must treat it as a blocking ERROR).
    """
    username = username_for(institutional_id) if institutional_id else None

    if username and users_by_username is not None:
        holder = users_by_username.get(username.casefold())
        if holder is not None and (
            linked_user is None or holder.pk != linked_user.pk
        ):
            return (
                ACTION_CONFLICT, username,
                f'Institutional ID "{institutional_id}" is already the login '
                "username for another account. Duplicate accounts are never "
                "created and identities are never merged.",
            )

    if linked_user is not None:
        return (
            ACTION_ACCOUNT_EXISTS, username,
            "Account already exists; its password, username and "
            "must-change-password flag are left unchanged.",
        )

    if account_eligible(effective_status, kind):
        return (
            ACTION_PROVISION, username,
            "New login account will be created with a generated initial "
            "password. The holder must change it at first login.",
        )

    return (
        ACTION_NO_ACCOUNT, username,
        "Master record already exists but no login is provisioned for an "
        "inactive/graduated record.",
    )


def _profile_field(kind: str) -> str:
    return "student_profile" if kind == "students" else "teacher_profile"


def provision_account(profile, kind: str, values) -> None:
    """Create + link a fresh User for an imported master record.

    ``profile`` must already be saved (pinned master). ``values`` carries the
    normalized email/name/ID. Only this function (inside an atomic confirmed
    import) may create accounts from institutional data. Raises
    ``ValidationError`` on any constraint violation so the outer
    ``transaction.atomic()`` rolls the whole import back.
    """
    from django.core.exceptions import ValidationError

    institutional_id = (values.get("student_id") or values.get("teacher_id")
                        or "").strip()
    username = username_for(institutional_id)
    if not username:
        raise ValidationError({"username": "Institutional ID is empty."})
    if not values.get("email"):
        raise ValidationError({"email": "Email is required for an account."})

    user = User(
        username=username,
        email=values["email"],
        name=values.get("name", ""),
        role=role_for(kind),
        is_active=True,
        must_change_password=True,
    )
    # The deterministic bootstrap password is hashed through Django's PBKDF2
    # pipeline and never stored/returned/logged (see module docstring).
    user.set_password(initial_password(institutional_id))
    setattr(user, _profile_field(kind), profile)
    user.save()