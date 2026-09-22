"""Centralized token authentication for the AAMS API.

Every endpoint that relies on DRF's default authentication chain shares the
same token lifecycle rules through ``ExpiringTokenAuthentication`` (the
``Token <key>`` wire contract is unchanged). Expired tokens are rejected with
a 401, deleted, and never fall through to SessionAuthentication so stale
tokens can never be silently promoted to a logged-in session.
"""
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed

from apps.accounts.models import ExpiringToken


class ExpiringTokenAuthentication(TokenAuthentication):
    """``Authorization: Token <key>`` authentication with an expiry check."""

    model = ExpiringToken
    keyword = "Token"

    def authenticate_credentials(self, key):
        try:
            token = self.model.objects.select_related("user").get(key=key)
        except self.model.DoesNotExist:
            raise AuthenticationFailed("Invalid token.")
        user = token.user
        if not user or not user.is_active:
            raise AuthenticationFailed("User inactive or deleted.")
        if token.is_expired:
            # Delete via the parent Token row so the child cascades away; a
            # replayed key is then rejected as invalid (401), never degraded.
            token.token_ptr.delete()
            raise AuthenticationFailed("Token has expired.")
        return (user, token)