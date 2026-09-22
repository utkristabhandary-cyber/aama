from django.contrib.auth import authenticate
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import ExpiringToken
from apps.accounts.permissions import IsAdminUser
from apps.accounts.provisioning import initial_password
from apps.accounts.serializers import (
    AdminPasswordResetSerializer,
    LoginSerializer,
    MeSerializer,
    PasswordChangeSerializer,
    UserSerializer,
)
from apps.accounts.throttling import LoginBurstThrottle, LoginThrottle


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle, LoginBurstThrottle])
def login(request):
    """Exchange username + password for an expiring DRF Token.

    A student's username is their college-issued student ID; teachers use their
    staff code; admins use a staff handle. Invalid credentials return a generic
    401 (no account-existence leak) and each failed attempt counts against the
    per-account/IP throttle budget.
    """
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = authenticate(
        request=request,
        username=serializer.validated_data["username"],
        password=serializer.validated_data["password"],
    )
    if not user:
        return Response(
            {"detail": "Invalid username or password."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    token = ExpiringToken.issue_for(user)
    LoginThrottle.clear_attempt(request)
    return Response({"token": token.key, "user": UserSerializer(user).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    try:
        request.user.auth_token.delete()
    except (Token.DoesNotExist, AttributeError):
        pass
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(MeSerializer(request.user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def password_change(request):
    """Self-service password change (full validator enforcement).

    The current password must be presented; on success the password is
    re-hashed, ``must_change_password`` clears, and every existing auth token
    is rotated so other sessions are signed out (current-session token is
    re-issued in the response).
    """
    serializer = PasswordChangeSerializer(
        data=request.data, context={"request": request}
    )
    serializer.is_valid(raise_exception=True)
    user = request.user
    if not user.check_password(serializer.validated_data["current_password"]):
        return Response(
            {
                "detail": "Current password is incorrect.",
                "code": "current_password_incorrect",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    user.set_password(serializer.validated_data["new_password"])
    user.must_change_password = False
    user.save(update_fields=["password", "must_change_password"])
    Token.objects.filter(user=user).delete()
    token = ExpiringToken.issue_for(user)
    return Response({"token": token.key, "user": UserSerializer(user).data})


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_password_reset(request):
    """Admin-initiated reset that re-applies the bootstrap lifecycle.

    The target account returns to ``must_change_password=True`` with the
    documented deterministic bootstrap password. Never returns the password
    (docs/25 §16 operational limitation); existing tokens are revoked.
    """
    serializer = AdminPasswordResetSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.user

    user.set_password(initial_password(user.username))
    user.must_change_password = True
    user.save(update_fields=["password", "must_change_password"])
    Token.objects.filter(user=user).delete()
    return Response(
        {
            "detail": (
                f'Password for "{user.username}" was reset. The holder must '
                "sign in again using their institutional ID and change the "
                "temporary password at the prompt. The password is never "
                "shown to anyone."
            ),
            "username": user.username,
            "must_change_password": True,
        }
    )