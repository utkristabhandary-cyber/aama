from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.notifications.models import Notification
from apps.notifications.serializers import NotificationSerializer


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        if self.request.user.is_authenticated:
            return Notification.objects.filter(recipient=self.request.user)
        return Notification.objects.none()

    def destroy(self, request, pk=None):
        """Delete one of the requester's own notifications.

        `get_object()` runs against the recipient-scoped queryset, so any
        attempt to remove another user's notification is a 404.
        """
        notification = self.get_object()
        notification.delete()
        return Response(status=204)

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = True
        notification.save(update_fields=["is_read"])
        return Response(NotificationSerializer(notification).data)

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        self.get_queryset().update(is_read=True)
        return Response({"detail": "All notifications marked as read."})