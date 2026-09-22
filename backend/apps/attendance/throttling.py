"""Rate limiting for the secure QR attendance endpoints.

Two layers protect the QR hot path against abuse without breaking a busy
classroom:

* ``QrCheckInThrottle`` — per-student budget for ``POST /attendance/qr/check-in/``.
  A single captured payload must not be hammered, but authentic camera scans
  from many students are naturally spread across different accounts.
* ``QrActionThrottle`` — per-user budget for token validation (`validate`,
  `mark`) and session lifecycle (`start`), bounding both teacher display
  polling and one client spraying guesses at the token check.

Rates are read from Django settings at request time (the same pattern as
``apps/accounts/throttling.py``), so they stay deterministic under
``override_settings`` in tests and are easy to tune per environment.
"""
from django.conf import settings

from rest_framework.throttling import SimpleRateThrottle


def _client_ip(request) -> str:
    return str(request.META.get("REMOTE_ADDR") or "unknown")


class QrCheckInThrottle(SimpleRateThrottle):
    """Per-student cap on QR check-in attempts."""

    scope = "qr_checkin"

    def __init__(self):
        self.THROTTLE_RATES = {
            "qr_checkin": getattr(
                settings, "AAMS_QR_CHECKIN_THROTTLE_RATE", "30/min"
            )
        }
        super().__init__()

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        # Keyed by the authenticated student so one user blaming a bad token
        # can never rate-limit the rest of the class (or vice versa).
        return f"throttle_qr_checkin_{request.user.pk}_{_client_ip(request)}"


class QrActionThrottle(SimpleRateThrottle):
    """Per-user budget for QR validate/mark/start operations."""

    scope = "qr_action"

    def __init__(self):
        self.THROTTLE_RATES = {
            "qr_action": getattr(
                settings, "AAMS_QR_ACTION_THROTTLE_RATE", "60/min"
            )
        }
        super().__init__()

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return f"throttle_qr_action_{request.user.pk}_{_client_ip(request)}"