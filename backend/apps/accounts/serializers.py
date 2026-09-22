from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "name",
            "email",
            "role",
            "avatar",
            "department",
            "teacher_profile",
            "student_profile",
            "is_staff",
            "must_change_password",
        ]
        read_only_fields = ["id", "is_staff", "must_change_password"]


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(write_only=True, trim_whitespace=False)
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class MeSerializer(serializers.ModelSerializer):
    teacher_id = serializers.SerializerMethodField()
    student_id = serializers.SerializerMethodField()
    semester_id = serializers.SerializerMethodField()
    section_id = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "name",
            "email",
            "role",
            "status",
            "avatar",
            "department",
            "teacher_id",
            "student_id",
            "semester_id",
            "section_id",
            "must_change_password",
        ]

    def get_teacher_id(self, obj):
        profile = getattr(obj, "teacher_profile", None)
        return profile.teacher_id if profile else None

    def get_student_id(self, obj):
        profile = getattr(obj, "student_profile", None)
        return profile.student_id if profile else None

    def get_semester_id(self, obj):
        profile = getattr(obj, "student_profile", None)
        return (
            profile.section.semester_id if profile and profile.section_id else None
        )

    def get_section_id(self, obj):
        profile = getattr(obj, "student_profile", None)
        return profile.section_id if profile else None

    def get_status(self, obj):
        return "active" if obj.is_active else "inactive"


class PasswordChangeSerializer(serializers.Serializer):
    """Self-service password change once the holder is authenticated.

    ``new_password`` is validated against the configured policy and the user
    must present their current password. This is where every configured
    ``AUTH_PASSWORD_VALIDATORS`` run — the bootstrap exemption (docs/25) does
    not apply beyond provisioning.
    """

    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_new_password(self, value):
        from django.contrib.auth.password_validation import validate_password

        validate_password(value, user=self.context["request"].user)
        return value


class AdminPasswordResetSerializer(serializers.Serializer):
    """Admin-initiated reset of another account's password.

    The account is put back into the same state as a freshly provisioned
    login: the documented deterministic bootstrap password and
    ``must_change_password``. The password is NEVER returned to the caller —
    this is an explicitly documented operational limitation (docs/25 §16):
    admins direct the holder to use their institutional ID to sign in.
    """

    username = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_username(self, value):
        user = User.objects.filter(username=value).first()
        if user is None:
            raise ValidationError("No account has this username.")
        self.user = user
        return value