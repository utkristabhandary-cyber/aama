"""Server-side half of the Phase D first-login gate (``must_change_password``).

The frontend renders ``ForcedPasswordChangeView`` in place of the whole portal
while the flag is set; this middleware makes the same restriction binding for
API clients that skip the UI: an authenticated account still holding the
importer-generated temporary password may only reach the auth endpoints needed
to complete the lifecycle (login, logout, me, password/change). Every other
``/api/`` route answers 403 with ``code: must_change_password_required`` until
a real password replaces the bootstrap one — there is no bypass route.

Design notes:

- Only ``/api/`` paths are inspected; Django admin, static, and preflight
  ``OPTIONS``/``HEAD`` requests pass through untouched.
- Token lookup mirrors ``ExpiringTokenAuthentication`` semantics: an unknown
  key, an inactive user, or an expired token is left for the auth class to
  reject with the canonical 401 (the auth class also deletes expired tokens).
- The gate exempts exactly the four lifecycle endpoints above. ``login`` is
  reached without a token (AllowAny) and so passes anyway; ``me`` and
  ``password/change`` must stay reachable while the flag is set.
"""
from django.http import JsonResponse

from apps.accounts.models import ExpiringToken

# Endpoints an account may use while still holding its temporary password.
ALLOWED_LIFECYCLE_ENDPOINTS = frozenset(
    {
        "/api/auth/login/",
        "/api/auth/logout/",
        "/api/auth/me/",
        "/api/auth/password/change/",
    }
)


class MustChangePasswordGateMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        gate_response = self._gate(request)
        if gate_response is not None:
            return gate_response
        return self.get_response(request)

    def _gate(self, request):
        if request.method in ("OPTIONS", "HEAD"):
            return None
        if not request.path.startswith("/api/"):
            return None
        if request.path in ALLOWED_LIFECYCLE_ENDPOINTS:
            return None

        authorization = request.META.get("HTTP_AUTHORIZATION", "")
        if not authorization.startswith("Token "):
            return None

        key = authorization[len("Token "):].strip()
        try:
            token = ExpiringToken.objects.select_related("user").get(key=key)
        except ExpiringToken.DoesNotExist:
            return None

        user = token.user
        if user is None or not user.is_active or not user.must_change_password:
            return None
        if token.is_expired:
            return None

        return JsonResponse(
            {
                "detail": (
                    "Your temporary password must be replaced before you can "
                    "use the portal."
                ),
                "code": "must_change_password_required",
            },
            status=403,
        )