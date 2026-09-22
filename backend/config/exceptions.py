"""AAMS API — custom DRF exception handler.

Converts Django ValidationError and other common exceptions into a
consistent JSON error envelope:
    {"detail": "...", "errors": {...}}
"""
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import (
    NotFound,
    PermissionDenied,
    ValidationError as DRFValidationError,
)
from rest_framework.response import Response
from rest_framework.views import exception_handler


def aams_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        # Django's ``ValidationError`` is either a flat list of messages or a
        # ``{field: [messages]}`` dict. ``message_dict`` raises AttributeError
        # for the flat-list form (no ``error_dict``), which would otherwise
        # turn a recoverable 400 into a 500. Fall back to ``messages``.
        try:
            detail = exc.message_dict or exc.messages
        except AttributeError:
            detail = exc.messages
        exc = DRFValidationError(detail=detail)
    if isinstance(exc, Http404):
        # A missing resource stays a real 404 — it must NOT be normalized to
        # a 400, otherwise clients cannot distinguish "not found" from a
        # malformed request.
        exc = NotFound()
    # Reuse DRF's default handling so DRF exceptions already carry a Response.
    response = exception_handler(exc, context)
    if response is None:
        return response
    if not isinstance(exc, PermissionDenied) and exc.status_code == status.HTTP_403_FORBIDDEN:
        return response
    if isinstance(response.data, dict) and "detail" not in response.data:
        response.data = {"detail": response.data}
    elif not isinstance(response.data, dict):
        response.data = {"detail": response.data}
    return response