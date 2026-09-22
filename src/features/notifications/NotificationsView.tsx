import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useToast } from '../../context/ToastContext';
import { notificationService } from '../../services/notificationService';
import { Notification } from '../../types';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  Trash2,
  Clock,
} from 'lucide-react';

export const NotificationsView: React.FC = () => {
  const { showToast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'alerts'>('all');

  const loadNotifications = useCallback(async () => {
    try {
      setNotifications(await notificationService.getNotifications());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkAllAsRead = async () => {
    await notificationService.markAllAsRead();
    showToast({ title: 'Marked All as Read', description: 'Notification queue cleared.', type: 'info' });
    loadNotifications();
  };

  const handleMarkAsRead = async (id: string) => {
    await notificationService.markAsRead(id);
    loadNotifications();
  };

  const handleDeleteNotification = async (id: string) => {
    await notificationService.deleteNotification(id);
    loadNotifications();
  };

  const filteredNotifications = useMemo(() => {
    return notifications.filter(n => {
      if (activeTab === 'unread') return !n.read;
      if (activeTab === 'alerts') return n.type === 'warning' || n.type === 'danger';
      return true;
    });
  }, [notifications, activeTab]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="space-y-6">
      {loading && (
        <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-700">
          Loading notifications from the live backend…
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between gap-3">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => loadNotifications()}>
            Retry
          </Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Institutional Notification Center</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Attendance notices, exam eligibility advisories, and campus administrative broadcasts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button size="sm" variant="outline" onClick={handleMarkAllAsRead}>
              Mark All as Read
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
        <Tabs
          activeTab={activeTab}
          onChange={val => setActiveTab(val as any)}
          tabs={[
            { id: 'all', label: 'All Notices', count: notifications.length },
            { id: 'unread', label: 'Unread', count: unreadCount },
            { id: 'alerts', label: 'Warnings & Alerts', count: notifications.filter(n => n.type === 'warning' || n.type === 'danger').length },
          ]}
        />
      </div>

      {/* Notification List */}
      <Card>
        <CardContent className="p-0 divide-y divide-slate-100">
          {filteredNotifications.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={<Bell className="w-6 h-6" />}
                title="No notifications in this view"
                description="Attendance notices and advisories issued by the institution will appear here."
              />
            </div>
          ) : (
            filteredNotifications.map(n => {
              const isUnread = !n.read;
              const formattedTime = new Date(n.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={n.id}
                  className={`p-4 transition-colors flex items-start justify-between gap-4 ${
                    isUnread ? 'bg-indigo-50/25 hover:bg-indigo-50/40' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                        n.type === 'warning'
                          ? 'bg-amber-100 text-amber-800'
                          : n.type === 'danger'
                          ? 'bg-rose-100 text-rose-800'
                          : n.type === 'success'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-indigo-100 text-indigo-800'
                      }`}
                    >
                      {n.type === 'warning' || n.type === 'danger' ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : n.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Info className="w-4 h-4" />
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className={`text-xs ${isUnread ? 'font-black text-slate-900' : 'font-bold text-slate-800'}`}>
                          {n.title}
                        </h4>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-indigo-600 inline-block" />
                        )}
                        <Badge
                          variant={
                            n.type === 'warning'
                              ? 'warning'
                              : n.type === 'danger'
                              ? 'danger'
                              : n.type === 'success'
                              ? 'success'
                              : 'info'
                          }
                        >
                          {n.type}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{n.message}</p>
                      <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1.5">
                        <span className="flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
                          {formattedTime}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isUnread && (
                      <button
                        onClick={() => handleMarkAsRead(n.id)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                      >
                        Mark Read
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteNotification(n.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
};
