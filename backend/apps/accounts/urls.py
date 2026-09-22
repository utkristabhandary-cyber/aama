from django.urls import path

from apps.accounts.views import (
    admin_password_reset,
    login,
    logout,
    me,
    password_change,
)

urlpatterns = [
    path("login/", login, name="auth-login"),
    path("logout/", logout, name="auth-logout"),
    path("me/", me, name="auth-me"),
    path("password/change/", password_change, name="auth-password-change"),
    path("password/reset/", admin_password_reset, name="auth-password-reset"),
]