"""Focused tests for the idempotent demo-seed management command.

Covers the deployment contract used by render.yaml:
``AAMS_SEED_DEMO_DATA=true`` invokes ``seed_demo_data --quiet``, so quiet
mode must succeed without echoing the demo password, the default output
must stay compatible, and re-runs must be side-effect free.
"""
import io

from django.contrib.auth import authenticate, get_user_model
from django.core.management import call_command
from django.test import TestCase

from apps.academics.models import Section, Semester, Subject
from apps.common.management.commands.seed_demo_data import DEMO_PASSWORD
from apps.notifications.models import Notification
from apps.students.models import Student
from apps.teachers.models import Teacher


class SeedDemoDataTests(TestCase):
    def _counts(self):
        User = get_user_model()
        return {
            "users": User.objects.count(),
            "teachers": Teacher.objects.count(),
            "students": Student.objects.count(),
            "semesters": Semester.objects.count(),
            "sections": Section.objects.count(),
            "subjects": Subject.objects.count(),
            "notifications": Notification.objects.count(),
        }

    def test_quiet_mode_hides_password(self):
        out = io.StringIO()
        call_command("seed_demo_data", quiet=True, stdout=out)
        output = out.getvalue()
        self.assertNotIn(DEMO_PASSWORD, output)
        self.assertIn("Seed complete", output)

    def test_default_output_unchanged(self):
        out = io.StringIO()
        call_command("seed_demo_data", stdout=out)
        output = out.getvalue()
        self.assertIn("Seed complete for SEM-S4", output)
        self.assertIn(DEMO_PASSWORD, output)

    def test_idempotent_second_run(self):
        call_command("seed_demo_data", quiet=True, stdout=io.StringIO())
        first = self._counts()
        self.assertGreater(first["users"], 0)

        out = io.StringIO()
        call_command("seed_demo_data", quiet=True, stdout=out)
        self.assertEqual(self._counts(), first)

    def test_demo_identities_authenticate(self):
        call_command("seed_demo_data", quiet=True, stdout=io.StringIO())
        for username, role in (
            ("admin", "admin"),
            ("tch-3", "teacher"),
            ("std-1", "student"),
        ):
            with self.subTest(username=username):
                user = authenticate(username=username, password=DEMO_PASSWORD)
                self.assertIsNotNone(user)
                self.assertTrue(user.is_active)
                self.assertEqual(user.role, role)
