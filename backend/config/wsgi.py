"""WSGI config for AAMS backend.

Defaults to the environment-gated base settings so a production server
started without an explicit DJANGO_SETTINGS_MODULE still honors
DJANGO_DEBUG / DJANGO_SECRET_KEY / DJANGO_ALLOWED_HOSTS instead of
forcing the development profile (DEBUG=True). Local development keeps
using config.settings.development via manage.py / explicit env.
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.base")

application = get_wsgi_application()