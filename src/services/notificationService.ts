import { NotificationItem } from '../types';
import { ApiNotification } from '../types/api';
import { apiClient } from './apiClient';

export const toNotificationItem = (n: ApiNotification): NotificationItem => ({
  id: String(n.id),
  title: n.title,
  message: n.message,
  type: (n.notification_type as NotificationItem['type']) || 'info',
  timestamp: n.created_at,
  isRead: n.is_read,
  read: n.is_read,
  createdAt: n.created_at,
});

export const notificationService = {
  async getNotifications(): Promise<NotificationItem[]> {
    const notifications = await apiClient.get<ApiNotification[]>('/notifications/');
    return notifications.map(toNotificationItem);
  },

  async markAsRead(id: string): Promise<void> {
    await apiClient.post(`/notifications/${id}/mark_read/`);
  },

  async markAllAsRead(): Promise<void> {
    await apiClient.post('/notifications/mark_all_read/');
  },

  async deleteNotification(id: string): Promise<void> {
    await apiClient.delete(`/notifications/${id}/`);
  },
};