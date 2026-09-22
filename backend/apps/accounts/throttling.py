"""Login brute-force throttling for the AAMS API.

Two layers protect ``POST /api/auth/login/``:

* ``LoginThrottle`` — per (client IP, username) failed-attempt budget
  (``AAMS_LOGIN_THROTTLE_RATE``, default ``5/min``). Successfully logging in
  resets the counter for that username, so normal usage is never penalized.
* ``LoginBurstThrottle`` — per-IP flood cap (``AAMS_LOGIN_IP_THROTTLE_RATE``,
  default ``100/min``) that bounds account/username enumeration from a single
  source.

Rates are read from Django settings at request time, so they are easy to
override per-environment and stay deterministic under ``override_settings``
in tests. The client IP is taken from ``REMOTE_ADDR`` (never trusting spoofable
``X-Forwarded-For`` unless a trusted proxy is added explicitly).
"""
from django.conf import settings
from django.core.cache import cache

from rest_framework.throttling import SimpleRateThrottle


def _client_ip(request) -> str:
    return str(request.META.get("REMOTE_ADDR") or "unknown")


class LoginThrottle(SimpleRateThrottle):
    """Throttle repeated login attempts per (client IP, username)."""

    scope = "login"

    def __init__(self):
        self.THROTTLE_RATES = {
            "login": getattr(settings, "AAMS_LOGIN_THROTTLE_RATE", "5/min")
        }
        super().__init__()

    def get_cache_key(self, request, view):
        username = str(request.data.get("username") or "").strip().lower()
        if not username:
            return None
        return f"throttle_login_{_client_ip(request)}_{username}"

    @classmethod
    def clear_attempt(cls, request):
        """Reset the failed-attempt budget after a successful login."""
        key = cls().get_cache_key(request, None)
        if key:
            cache.delete(key)


class LoginBurstThrottle(SimpleRateThrottle):
    """Per-IP flood cap so one source cannot hammer the login endpoint."""

    scope = "login_ip"

    def __init__(self):
        self.THROTTLE_RATES = {
            "login_ip": getattr(settings, "AAMS_LOGIN_IP_THROTTLE_RATE", "100/min")
        }
        super().__init__()

    def get_cache_key(self, request, view):
        return f"throttle_login_ip_{_client_ip(request)}"