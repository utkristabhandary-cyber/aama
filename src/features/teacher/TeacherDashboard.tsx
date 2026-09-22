import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { teacherService } from '../../services/teacherService';
import { reportService } from '../../services/reportService';
import { holidayService } from '../../services/holidayService';
import { StatCard } from '../../components/ui/StatCard';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  ArrowRight,
  Calendar,
} from 'lucide-react';

export interface TeacherDashboardProps {
  onStartAttendance: (slotId?: string) => void;
  onNavigate: (viewId: string) => void;
}

const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({
  onStartAttendance,
  onNavigate,
}) => {
  const { user } = useAuth();

  const [teacherData, setTeacherData] = useState<any>({
    teacher: null,
    assignments: [],
    todayClasses: [],
    sessionsConducted: 0,
    averageRate: 0,
    todayName: WEEK_DAYS[new Date().getDay()] || 'Sunday',
    isHoliday: false,
    holidayTitle: '',
    loading: true,
  });

  useEffect(() => {
    loadTeacherData();
  }, [user]);

  const loadTeacherData = async () => {
    if (!user) return;
    try {
      const teacher = await teacherService.getCurrentTeacher(user);
      if (!teacher) {
        setTeacherData((prev: any) => ({ ...prev, loading: false }));
        return;
      }

      // Teaching classes are built server-side from the teacher-scoped
      // assignments + teaching-sessions endpoints (see teacherService).
      const classes = await teacherService.getTeacherClasses(teacher.id);

      // Server-computed, teacher-scoped attendance summary.
      const summary = await reportService.getScopedSummary().catch(() => null);

      const todayName = WEEK_DAYS[new Date().getDay()] || 'Sunday';
      const todayStr = new Date().toISOString().split('T')[0];
      const holiday = await holidayService.isHolidayDate(todayStr).catch(() => undefined);

      const todayClasses = classes
        .filter(c => c.day === todayName)
        .map(c => ({
          id: c.id,
          subjectName: c.subject?.name || 'Course',
          subjectCode: c.subject?.code || '',
          sectionName: c.sectionLabels || 'Section',
          room: c.session?.room || '',
          startTime: c.session?.startTime || '',
          endTime: c.session?.endTime || '',
        }));

      setTeacherData({
        teacher,
        assignments: classes,
        todayClasses,
        sessionsConducted: summary?.totalAttendanceSessions ?? 0,
        averageRate:
          summary != null ? Math.round(summary.attendancePercentage) : 0,
        todayName,
        isHoliday: !!holiday,
        holidayTitle: holiday?.title || '',
        loading: false,
      });
    } catch (err) {
      console.error('Failed loading teacher dashboard', err);
      setTeacherData((prev: any) => ({ ...prev, loading: false }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="p-6 rounded-2xl bg-emerald-900 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs uppercase font-bold tracking-wider text-emerald-300 block">
            Faculty Teaching Portal
          </span>
          <h2 className="text-xl sm:text-2xl font-black mt-1">
            Welcome back, {teacherData.teacher?.name || 'Professor'}
          </h2>
          <p className="text-xs text-slate-300 mt-1">
            {teacherData.teacher?.designation} • {teacherData.teacher?.department}
          </p>
        </div>
        <Button
          size="lg"
          variant="primary"
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold border-none shrink-0"
          leftIcon={<CheckCircle2 className="w-4 h-4" />}
          onClick={() => onStartAttendance()}
        >
          Start Attendance Roll Call
        </Button>
      </div>

      {/* Holiday Notification */}
      {teacherData.isHoliday && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <Calendar className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-bold text-amber-900 uppercase tracking-wider block">
              Institutional Holiday: {teacherData.holidayTitle}
            </span>
            <p className="text-xs text-amber-800 mt-0.5">
              Today is an official academic holiday. Regularly scheduled timetable classes are suspended.
            </p>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Assigned Classes"
          value={teacherData.assignments.length}
          icon={<BookOpen className="w-5 h-5 text-emerald-600" />}
          subtitle="Active curriculum courses"
          badge={{ text: 'Active', variant: 'success' }}
          onClick={() => onNavigate('my-classes')}
        />
        <StatCard
          title="Class Attendance Rate"
          value={`${teacherData.averageRate}%`}
          icon={<CheckCircle2 className="w-5 h-5 text-indigo-600" />}
          subtitle="Across your student sections"
          badge={{ text: 'Above Target', variant: 'info' }}
          onClick={() => onNavigate('reports')}
        />
        <StatCard
          title="Sessions Conducted"
          value={teacherData.sessionsConducted}
          icon={<Clock className="w-5 h-5 text-purple-600" />}
          subtitle="Verified attendance logs"
          badge={{ text: 'Audit Ready', variant: 'default' }}
          onClick={() => onNavigate('attendance-history')}
        />
        <StatCard
          title={`${teacherData.todayName} Scheduled`}
          value={teacherData.todayClasses.length}
          icon={<Calendar className="w-5 h-5 text-amber-600" />}
          subtitle="Lectures on today's calendar"
          badge={{ text: teacherData.isHoliday ? 'Suspended' : 'Scheduled', variant: 'warning' }}
          onClick={() => onNavigate('my-timetable')}
        />
      </div>

      {/* Main Grid: Today's Classes & Assigned Subjects */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today's Lectures */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle>Today's Teaching Schedule</CardTitle>
              <CardDescription>Scheduled timetable lectures for {teacherData.todayName}</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
              onClick={() => onNavigate('my-timetable')}
            >
              Full Timetable
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {teacherData.todayClasses.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No classes scheduled for today.
              </div>
            ) : (
              teacherData.todayClasses.map((slot: any) => (
                <div
                  key={slot.id}
                  className="p-4 rounded-xl border border-slate-200 bg-white hover:border-emerald-300 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-800 shrink-0">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900">{slot.subjectName}</h4>
                        <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                          {slot.subjectCode}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {slot.sectionName} • {slot.room}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-center">
                    <span className="text-xs font-mono font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded">
                      {slot.startTime}–{slot.endTime}
                    </span>
                    <Button
                      size="sm"
                      variant="primary"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                      leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                      onClick={() => onStartAttendance(slot.id)}
                    >
                      Take Attendance
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Assigned Courses Summary */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle>My Teaching Allocations</CardTitle>
            <CardDescription>Assigned courses & cohort sections</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 flex-1 overflow-y-auto">
            {teacherData.assignments.map((cls: any) => (
              <div
                key={cls.id}
                className="p-3 rounded-lg border border-slate-100 bg-slate-50 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono font-bold text-indigo-700">{cls.subject?.code}</span>
                    <span className="text-xs font-bold text-slate-800">{cls.subject?.name}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Section {cls.sectionLabels} • {cls.totalStudents} students
                  </p>
                </div>
                <Badge variant="outline">{cls.subject?.type || cls.session?.classType}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
