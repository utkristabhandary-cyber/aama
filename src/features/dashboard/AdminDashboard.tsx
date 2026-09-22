import React, { useState, useEffect, useCallback } from 'react';
import { StatCard } from '../../components/ui/StatCard';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import {
  Users,
  GraduationCap,
  CalendarDays,
  Layers,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Plus,
  BookOpen,
  Briefcase,
  TrendingUp,
  ArrowRight,
  Sparkles,
  Calendar,
} from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import { holidayService } from '../../services/holidayService';
import { reportService } from '../../services/reportService';
import { ApiTimetableSlot, ApiAttendanceSession } from '../../types/api';

export interface AdminDashboardProps {
  onNavigate: (viewId: string) => void;
  onOpenQuickAction?: (action: 'add-student' | 'add-teacher' | 'add-subject' | 'add-timetable') => void;
  onStartAttendance?: (slotId?: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  onNavigate,
  onOpenQuickAction,
  onStartAttendance,
}) => {
  const [stats, setStats] = useState({
    studentsCount: 0,
    teachersCount: 0,
    activeSemestersCount: 0,
    sectionsCount: 0,
    subjectsCount: 0,
    totalSemestersCount: 0,
    averageAttendance: 0,
    totalSessions: 0,
    studentsAtRiskCount: 0,
    bySubject: [] as { key: string; label: string; percentage: number }[],
    todayClasses: [] as any[],
    recentSessions: [] as any[],
    isTodayHoliday: false,
    holidayTitle: '',
    loading: true,
    error: '',
  });

  const loadDashboardData = useCallback(async () => {
    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];
      const todayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][today.getDay()] || 'Sunday';

      const [analytics, timetable, holiday, sessions] = await Promise.all([
        reportService.getAdminAnalytics().catch(() => null),
        apiClient.list<ApiTimetableSlot>('/academics/timetable/', { day: todayName }).catch(() => []),
        holidayService.isHolidayDate(todayStr).catch(() => undefined),
        apiClient.list<ApiAttendanceSession>('/attendance/sessions/').catch(() => []),
      ]);

      const counts = analytics?.counts;
      const attendance = analytics?.attendance;

      const todayClasses = (timetable || []).map(slot => ({
        ...slot,
        subjectName: slot.subject_name,
        subjectCode: slot.subject_code,
        teacherName: slot.teacher_name,
        sectionName: slot.section_names && slot.section_names.length > 0
          ? slot.section_names.join(' & ')
          : slot.section_name,
        startTime: (slot.start_time || '').slice(0, 5),
        endTime: (slot.end_time || '').slice(0, 5),
      }));

      const recentSessions = (sessions || [])
        .slice()
        .sort((a, b) => b.id - a.id)
        .slice(0, 4)
        .map(sess => {
          const records = sess.records || [];
          const presentCount = records.filter(r => r.status === 'present').length;
          const totalCount = records.length;
          return {
            ...sess,
            date: sess.session_date,
            subjectName: sess.subject_name || 'Subject',
            subjectCode: sess.subject_code || '',
            sectionName: sess.section_names.length > 0 ? sess.section_names.join(', ') : 'Section',
            teacherName: sess.teacher_name || 'Faculty',
            startTime: (sess.start_time || '').slice(0, 5),
            endTime: (sess.planned_end_time || '').slice(0, 5),
            presentCount,
            totalCount,
            pct: totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0,
          };
        });

      setStats({
        studentsCount: counts?.totalStudents ?? 0,
        teachersCount: counts?.totalTeachers ?? 0,
        activeSemestersCount: counts?.activeSemesters ?? 0,
        sectionsCount: counts?.totalSections ?? 0,
        subjectsCount: counts?.totalSubjects ?? 0,
        totalSemestersCount: counts?.totalSemesters ?? 0,
        averageAttendance: attendance?.attendancePercentage ?? 0,
        totalSessions: attendance?.totalAttendanceSessions ?? 0,
        studentsAtRiskCount: analytics?.studentsAtRisk?.length ?? 0,
        bySubject: (analytics?.bySubject || [])
          .map(sub => ({
            key: String(sub.subjectId),
            label: `${sub.subjectCode} — ${sub.subjectName}`,
            percentage: sub.percentage,
          }))
          .slice(0, 4),
        todayClasses,
        recentSessions,
        isTodayHoliday: !!holiday,
        holidayTitle: holiday?.title || '',
        loading: false,
        error: '',
      });
    } catch (err) {
      setStats(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load dashboard data.',
      }));
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  return (
    <div className="space-y-6">
      {stats.loading && (
        <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-700">
          Loading institutional analytics from the live backend…
        </div>
      )}
      {stats.error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between gap-3">
          <span>{stats.error}</span>
          <Button size="sm" variant="outline" onClick={() => loadDashboardData()}>
            Retry
          </Button>
        </div>
      )}

      {/* Institutional Notice / Holiday Banner */}
      {stats.isTodayHoliday && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-amber-50 border border-amber-200 gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 text-amber-800 shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                  Institutional Holiday Today
                </span>
                <Badge variant="warning">
                  {new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}
                </Badge>
              </div>
              <p className="text-xs text-amber-900 mt-0.5 font-medium">
                {stats.holidayTitle}. Timetable class sessions are suspended.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-300 text-amber-900 hover:bg-amber-100/60 shrink-0 text-xs"
            onClick={() => onNavigate('calendar')}
          >
            View Academic Calendar
          </Button>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Students"
          value={stats.studentsCount}
          icon={<Users className="w-5 h-5 text-indigo-600" />}
          subtitle="Student profiles on record"
          badge={{ text: 'Live', variant: 'success' }}
          onClick={() => onNavigate('students')}
        />
        <StatCard
          title="Faculty Members"
          value={stats.teachersCount}
          icon={<Briefcase className="w-5 h-5 text-emerald-600" />}
          subtitle="Teaching staff on record"
          badge={{ text: 'Active', variant: 'info' }}
          onClick={() => onNavigate('teachers')}
        />
        <StatCard
          title="Active Semesters"
          value={stats.activeSemestersCount}
          icon={<CalendarDays className="w-5 h-5 text-blue-600" />}
          subtitle={`${stats.totalSemestersCount} academic term(s) on record`}
          badge={{ text: 'In progress', variant: 'default' }}
          onClick={() => onNavigate('semesters')}
        />
        <StatCard
          title="Institutional Sections"
          value={stats.sectionsCount}
          icon={<Layers className="w-5 h-5 text-purple-600" />}
          subtitle="Sections across active semesters"
          badge={{ text: `${stats.subjectsCount} Courses`, variant: 'default' }}
          onClick={() => onNavigate('sections')}
        />
      </div>

      {/* Quick Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Academic Quick Actions</h3>
          <p className="text-xs text-slate-500">Fast-track institutional management operations</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => {
              if (onOpenQuickAction) onOpenQuickAction('add-student');
              else onNavigate('students');
            }}
          >
            Add Student
          </Button>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => {
              if (onOpenQuickAction) onOpenQuickAction('add-teacher');
              else onNavigate('teachers');
            }}
          >
            Add Teacher
          </Button>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => {
              if (onOpenQuickAction) onOpenQuickAction('add-subject');
              else onNavigate('subjects');
            }}
          >
            Add Subject
          </Button>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => {
              if (onOpenQuickAction) onOpenQuickAction('add-timetable');
              else onNavigate('timetable');
            }}
          >
            Add Timetable Slot
          </Button>
        </div>
      </div>

      {/* Main Grid: Attendance Overview & Today's Schedule */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Attendance Analytics Card (2 Cols) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Attendance Health & Trends</CardTitle>
              <CardDescription>
                Consolidated attendance performance for Semester 1 cohorts
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              onClick={() => onNavigate('reports')}
            >
              Full Reports
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Campus Average
                </p>
                <p className="text-3xl font-extrabold text-slate-900 mt-1">
                  {stats.averageAttendance}%
                </p>
                <div className="mt-2">
                  <ProgressBar value={stats.averageAttendance} size="sm" />
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Sessions Conducted
                </p>
                <p className="text-3xl font-extrabold text-slate-900 mt-1">
                  {stats.totalSessions}
                </p>
                <p className="text-xs text-slate-500 mt-1">Verified academic hours</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Threshold Status
                </p>
                {stats.totalSessions === 0 ? (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md w-fit border border-slate-200">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <span>Awaiting attendance data</span>
                  </div>
                ) : stats.averageAttendance >= 75 ? (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-100/60 px-2.5 py-1 rounded-md w-fit border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Above 75% Standard</span>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-100/60 px-2.5 py-1 rounded-md w-fit border border-rose-200">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>Below 75% Standard</span>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 mt-1">
                  {stats.studentsAtRiskCount > 0
                    ? `${stats.studentsAtRiskCount} student${stats.studentsAtRiskCount === 1 ? '' : 's'} require${stats.studentsAtRiskCount === 1 ? 's' : ''} intervention`
                    : 'All marked students are above the 75% threshold'}
                </p>
              </div>
            </div>

            {/* Subject-Wise Performance Progress Bars */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                Course-Wise Attendance Ratios
              </h4>
              <div className="space-y-3">
                {stats.bySubject.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No course attendance data recorded yet.
                  </p>
                ) : (
                  stats.bySubject.map(sub => (
                    <div key={sub.key}>
                      <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                        <span>{sub.label}</span>
                        <span className="font-bold text-slate-900">{sub.percentage}%</span>
                      </div>
                      <ProgressBar
                        value={sub.percentage}
                        size="md"
                        colorScheme={sub.percentage < 75 ? 'rose' : 'emerald'}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Today's Timetable Schedule */}
        <Card className="flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>
                {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][new Date().getDay()] || 'Today'} Schedule
              </CardTitle>
              <CardDescription>Scheduled timetable sessions for today</CardDescription>
            </div>
            <Badge variant={stats.isTodayHoliday ? 'warning' : 'info'}>
              {stats.isTodayHoliday ? 'Holiday' : `${stats.todayClasses.length} Sessions`}
            </Badge>
          </CardHeader>
          <CardContent className="flex-1 space-y-3">
            {stats.todayClasses.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No timetable sessions are scheduled for today.
              </div>
            ) : stats.todayClasses.slice(0, 4).map(slot => (
              <div
                key={slot.id}
                className="p-3 rounded-lg border border-slate-100 bg-slate-50/70 flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-800 truncate">
                      {slot.subjectCode}: {slot.subjectName}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {slot.sectionName} • {slot.teacherName} • {slot.room}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[11px] font-mono font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                    {slot.startTime}–{slot.endTime}
                  </span>
                </div>
              </div>
            ))}
            {stats.todayClasses.length > 4 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-indigo-600"
                onClick={() => onNavigate('timetable')}
              >
                View all {stats.todayClasses.length} timetable sessions →
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity: Submitted Sessions Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Verified Attendance Sessions</CardTitle>
            <CardDescription>
              Real-time attendance logs submitted by department teachers
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('attendance')}
          >
            View All Sessions
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Date & Time</th>
                  <th className="px-5 py-3">Course / Subject</th>
                  <th className="px-5 py-3">Section</th>
                  <th className="px-5 py-3">Instructor</th>
                  <th className="px-5 py-3">Attendance Rate</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {stats.recentSessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-xs text-slate-400">
                      No attendance sessions recorded yet. Sessions submitted by teachers will appear here.
                    </td>
                  </tr>
                ) : stats.recentSessions.map(sess => (
                  <tr key={sess.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-slate-900 whitespace-nowrap">
                      {sess.date}
                      <span className="text-slate-400 font-normal ml-2 font-mono">
                        {sess.startTime}–{sess.endTime}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-slate-800">{sess.subjectName}</div>
                      <div className="text-[11px] text-slate-400">{sess.subjectCode}</div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap font-medium text-slate-700">
                      {sess.sectionName}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">{sess.teacherName}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{sess.pct}%</span>
                        <span className="text-[10px] text-slate-400">
                          ({sess.presentCount}/{sess.totalCount})
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <Badge variant="success">Submitted</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
