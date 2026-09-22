from django.contrib.auth import get_user_model

from rest_framework.test import APITestCase

from apps.accounts.models import Role
from apps.notifications.models import Notification

User = get_user_model()


class NotificationsApiTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@notif.local", password="Passw0rd!", role=Role.ADMIN
        )
        self.other = User.objects.create_user(
            email="other@notif.local", password="Passw0rd!", role=Role.STUDENT
        )
        self.notification = Notification.objects.create(
            recipient=self.admin,
            title="Session finalized",
            message="Attendance for COMP1 is now locked.",
            notification_type="info",
        )
        self.unread = Notification.objects.create(
            recipient=self.admin,
            title="Second",
            message="Still unread.",
            notification_type="warning",
        )

    def test_list_is_recipient_scoped(self):
        self.client.force_authenticate(user=self.other)
        response = self.client.get("/api/notifications/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)

        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/notifications/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)

    def test_mark_read_and_mark_all_read(self):
        self.client.force_authenticate(user=self.admin)
        mark = self.client.post(
            f"/api/notifications/{self.notification.pk}/mark_read/"
        )
        self.assertEqual(mark.status_code, 200)
        self.assertTrue(mark.data["is_read"])

        mark_all = self.client.post("/api/notifications/mark_all_read/")
        self.assertEqual(mark_all.status_code, 200)
        self.assertFalse(
            Notification.objects.filter(
                recipient=self.admin, is_read=False
            ).exists()
        )

    def test_destroy_own_notification(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(
            f"/api/notifications/{self.notification.pk}/"
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(
            Notification.objects.filter(pk=self.notification.pk).exists()
        )

    def test_cannot_destroy_or_mark_another_users_notification(self):
        self.client.force_authenticate(user=self.other)
        delete = self.client.delete(
            f"/api/notifications/{self.notification.pk}/"
        )
        self.assertEqual(delete.status_code, 404)
        mark = self.client.post(
            f"/api/notifications/{self.notification.pk}/mark_read/"
        )
        self.assertEqual(mark.status_code, 404)
        self.assertTrue(
            Notification.objects.filter(pk=self.notification.pk).exists()
        )

    def test_anonymous_blocked(self):
        response = self.client.get("/api/notifications/")
        self.assertEqual(response.status_code, 401)