"""AAMS backend — shared Django settings.

All values that are environment-specific are read from environment variables
(optionally loaded from the project-root .env file). No credentials are
hard-coded here.
"""
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

from dotenv import load_dotenv

# backend/  -> config/settings/base.py
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
# Repo root (where .env lives)
PROJECT_ROOT = BACKEND_DIR.parent

load_dotenv(PROJECT_ROOT / ".env")

# Security -------------------------------------------------------------
DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() in ("1", "true", "yes")

# In production the secret key MUST come from the environment. The local
# development default is only safe while DEBUG is enabled.
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-aams-secret-key-change-before-deploy"
    else:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY must be set when DEBUG is disabled."
        )

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv(
        "DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1"
    ).split(",")
    if host.strip()
]

# Application definition ------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "corsheaders",
    "rest_framework",
    "rest_framework.authtoken",
    "django_filters",
    # AAMS apps
    "apps.common",
    "apps.imports",
    "apps.accounts",
    "apps.academics",
    "apps.teachers",
    "apps.students",
    "apps.attendance",
    "apps.timesheet",
    "apps.reports",
    "apps.notifications",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.accounts.middleware.MustChangePasswordGateMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Database -----------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": os.getenv("DB_ENGINE", "django.db.backends.postgresql"),
        "NAME": os.getenv("DB_NAME") or "aams_db",
        "USER": os.getenv("DB_USER") or "aams_user",
        "PASSWORD": os.getenv("DB_PASSWORD", ""),
        "HOST": os.getenv("DB_HOST") or "127.0.0.1",
        "PORT": os.getenv("DB_PORT") or "5432",
        "CONN_MAX_AGE": 60,
    }
}

# Custom user model --------------------------------------------------
AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "UserAttributeSimilarityValidator"
        )
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"
    },
]

# Internationalization ------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = os.getenv("DJANGO_TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

# Static & media -------------------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BACKEND_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BACKEND_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Django REST Framework ------------------------------------------------
# Token lifetime in seconds. A positive value gives every issued token an
# explicit expiration; 0 disables expiry and is intended for LOCAL
# DEVELOPMENT ONLY — production must configure a real lifetime.
AAMS_TOKEN_TTL_SECONDS = int(os.getenv("AAMS_TOKEN_TTL_SECONDS", "2592000"))

# Login brute-force throttling (see apps/accounts/throttling.py).
AAMS_LOGIN_THROTTLE_RATE = os.getenv("AAMS_LOGIN_THROTTLE_RATE", "5/min")
AAMS_LOGIN_IP_THROTTLE_RATE = os.getenv("AAMS_LOGIN_IP_THROTTLE_RATE", "100/min")

# Secure QR attendance (see apps/attendance/).
# Lifetime of a QR roll-call token before the server rotates it. Tokens are
# short-lived by design; a fresh payload is issued when the running classroom
# display polls again. Read from settings AT REQUEST TIME so tests can
# override it deterministically.
AAMS_QR_TOKEN_TTL_SECONDS = int(os.getenv("AAMS_QR_TOKEN_TTL_SECONDS", "15"))

# This application is web-only. Browsers cannot attest a classroom BSSID, so
# `resolve_network_verification()` always returns "unavailable". When True,
# student check-ins that cannot prove OS-attested network verification (i.e.
# every web path) are rejected with an explicit "network verification
# required" response. Default False keeps the web QR scanner usable on token
# strength alone.
AAMS_QR_REQUIRE_NETWORK_VERIFICATION = os.getenv(
    "AAMS_QR_REQUIRE_NETWORK_VERIFICATION", "false"
).lower() in {"1", "true", "yes", "on"}

# QR endpoint throttling (see apps/attendance/throttling.py). Check-in is
# budgeted per student so a single captured payload cannot be hammered, while
# generous enough for a classroom of authentic camera scans.
AAMS_QR_CHECKIN_THROTTLE_RATE = os.getenv("AAMS_QR_CHECKIN_THROTTLE_RATE", "30/min")
AAMS_QR_ACTION_THROTTLE_RATE = os.getenv("AAMS_QR_ACTION_THROTTLE_RATE", "60/min")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # ExpiringToken FIRST: an invalid/expired `Authorization: Token ...`
        # MUST surface as 401 before SessionAuthentication claims the
        # anonymous user (otherwise stale tokens would degrade to 403 and the
        # frontend session-expiry handler would never fire).
        "apps.accounts.authentication.ExpiringTokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated"
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 100,
    "EXCEPTION_HANDLER": "config.exceptions.aams_exception_handler",
}

# CORS (Vite frontend) --------------------------------------------------
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
CORS_ALLOW_CREDENTIALS = True

# Production security flags ------------------------------------------------
# Environment-gated so the plain-HTTP local stack keeps working untouched,
# while a production deployment can harden without code changes:
#   DJANGO_SECURE_SSL_REDIRECT=1           redirect HTTP -> HTTPS
#   DJANGO_SESSION_COOKIE_SECURE=1         session cookie sent over HTTPS only
#   DJANGO_CSRF_COOKIE_SECURE=1            CSRF cookie sent over HTTPS only
#   DJANGO_SECURE_HSTS_SECONDS=31536000    enable HSTS for 1 year
#   DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS=1 / DJANGO_SECURE_HSTS_PRELOAD=1
# These only apply once DEBUG is off and SSL is terminated before Django;
# see the Phase K production-hardening report for the full checklist.
def _env_bool(name):
    return os.getenv(name, "false").lower() in {"1", "true", "yes", "on"}


SECURE_SSL_REDIRECT = _env_bool("DJANGO_SECURE_SSL_REDIRECT")
SECURE_PROXY_SSL_HEADER = (
    ("HTTP_X_FORWARDED_PROTO", "https") if SECURE_SSL_REDIRECT else None
)
SESSION_COOKIE_SECURE = _env_bool("DJANGO_SESSION_COOKIE_SECURE")
CSRF_COOKIE_SECURE = _env_bool("DJANGO_CSRF_COOKIE_SECURE")
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_SECURE_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = _env_bool(
    "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS"
)
SECURE_HSTS_PRELOAD = _env_bool("DJANGO_SECURE_HSTS_PRELOAD")
SECURE_REFERRER_POLICY = os.getenv("DJANGO_SECURE_REFERRER_POLICY", "same-origin")
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"