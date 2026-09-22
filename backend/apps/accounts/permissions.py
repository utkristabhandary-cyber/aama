"""Role-based permission classes.

The backend is the authority for authorization; frontend route guards are a
UX convenience only. These classes map the AAMS roles (admin/teacher/student)
onto DRF permissions.
"""
from rest_framework.permissions import BasePermission


class IsAdminUser(BasePermission):
    """Allow only users with the admin role."""

    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated
            and request.user.role == "admin"
        )


class IsTeacherUser(BasePermission):
    """Allow only users with the teacher role."""

    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated
            and request.user.role == "teacher"
        )


class IsStudentUser(BasePermission):
    """Allow only users with the student role."""

    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated
            and request.user.role == "student"
        )


class IsAdminOrTeacher(BasePermission):
    """Allow admins and teachers (staff-facing roles)."""

    def has_permission(self, request, view):
        return bool(
            request.user and request.user.is_authenticated
            and request.user.role in ("admin", "teacher")
        )


class ReadOnly(BasePermission):
    """Allow read-safe methods for any authenticated user."""

    SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.method in self.SAFE_METHODS
        )


class AdminOrReadOnly(BasePermission):
    """Read for any authenticated user, mutations for admins only."""

    SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in self.SAFE_METHODS:
            return True
        return request.user.role == "admin"


class AdminOrTeacherRead(BasePermission):
    """Reads for admins & teachers, mutations for admins only.

    Keeps students from enumerating PII across the teacher/student catalogs.
    """

    SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in self.SAFE_METHODS:
            return request.user.role in ("admin", "teacher")
        return request.user.role == "admin"