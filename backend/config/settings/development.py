"""Development settings — layered on top of shared base settings."""
import os

from .base import *  # noqa: F401,F403  (intentionally re-exports base)

DEBUG = True

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv(
        "DJANGO_ALLOWED_HOSTS",
        "localhost,127.0.0.1,testserver,192.168.1.70,192.168.1.73",
    ).split(",")
    if host.strip()
]