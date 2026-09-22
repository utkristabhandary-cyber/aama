import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { studentService } from '../../services/studentService';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { subjectService } from '../../services/subjectService';
import { teacherService } from '../../services/teacherService';
import { Subject, Teacher } from '../../types';
import { StatCard } from '../../components/ui/StatCard';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Button } from '../../components/ui/Button';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  QrCode,
  ArrowRight,
} from 'lucide-react';

export const StudentDashboard: React.FC<{ onNavigate: (viewId: string) => void }> = ({
  onNavigate,
}) => {
  const { user } = useAuth();
  const [data, setData] = useState<any>({
    student: null,
    semester: null,
    section: null,
    summary: { total: 0, present: 0, absent: 0, late: 0, percentage: 0 },
    subjectBreakdown: [],
    todayClasses: [],
    neededClassesToRecover: 0,
    todayName: 'Sunday',
    loading: true,
  });

  useEffect(() => {
    loadStudentData();
  }, [user]);

  const loadStudentData = async () => {
    if (!user) return;
    try {
      const student = await studentService.getCurrentStudent(user);
      if (!student) {
        setData((prev: any) => ({ ...prev, loading: false }));
        return;
      }

      const [semester, section, attendance, subjects] = await Promise.all([
        semesterService.getSemesterById(student.semesterId).catch(() => null),
        sectionService.getSectionById(student.sectionId).catch(() => null),
        studentService.getMyAttendance(student.id),
        subjectService.getSubjects().catch(() => []),
      ]);

      const subjectById = new Map<string, Subject>(subjects.map((s): [string, Subject] => [s.id, s]));

      // Server-computed summary: present counts both present and late marks.
      const summary = {
        total: attendance.overallTotal,
        present: attendance.overallPresent,
        absent: attendance.overallTotal - attendance.overallPresent,
        late: 0,
        percentage: Math.round(attendance.overallPercentage),
      };

      // Server-computed per-subject breakdown; absent is derived (total - present).
      const subjectBreakdown = attendance.subjects.map(sub => {
        const meta = subjectById.get(String(sub.subjectId));
        return {
          id: String(sub.subjectId),
          code: sub.subjectCode,
          name: sub.subjectName,
          credits: meta?.credits,
          type: meta?.type,
          total: sub.total,
          present: sub.present,
          absent: sub.total - sub.present,
          late: 0,
          percentage: Math.round(sub.percentage),
        };
      });

      // Section timetable from the backend, filtered to today.
      const todayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][
        new Date().getDay()
      ] || 'Sunday';
      const [timetable, teachers] = await Promise.all([
        studentService.getMyTimetable(student.id, student.sectionId).catch(() => []),
        teacherService.getTeachers().catch(() => []),
      ]);
      const teacherById = new Map<string, Teacher>(teachers.map((t): [string, Teacher] => [t.id, t]));

      const dayClasses = timetable.filter(t => t.day === todayName);
      const displayClasses = dayClasses.length > 0 ? dayClasses : timetable.slice(0, 4);
      const formattedClasses = displayClasses.map(slot => ({
        id: slot.id,
        subjectName: subjectById.get(slot.subjectId)?.name || 'Course',
        subjectCode: subjectById.get(slot.subjectId)?.code || '',
        teacherName: teacherById.get(slot.teacherId)?.name || 'Faculty',
        startTime: slot.startTime,
        endTime: slot.endTime,
        room: slot.room,
      }));

      // Calculate recovery count if below 75%
      let needed = 0;
      if (summary.percentage < 75 && summary.total > 0) {
        needed = Math.max(0, Math.ceil((0.75 * summary.total - summary.present) / 0.25));
      }

      setData({
        student,
        semester,
        section,
        summary,
        subjectBreakdown,
        todayClasses: formattedClasses,
        neededClassesToRecover: needed,
        todayName,
        loading: false,
      });
    } catch (err) {
      console.error('Failed loading student dashboard', err);
      setData((prev: any) => ({ ...prev, loading: false }));
    }
  };

  const isEligible = data.summary.percentage >= 75;

  return (
    <div className="space-y-6">
      {/* Student Welcome Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-indigo-900 to-slate-900 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs uppercase font-bold tracking-wider text-indigo-300 block">
            Student Academic Dossier
          </span>
          <h2 className="text-xl sm:text-2xl font-black mt-1">
            {data.student?.name || 'Student Portal'}
          </h2>
          <p className="text-xs text-slate-300 mt-1">
            Roll #{data.student?.rollNo} • ID: {data.student?.studentId} • {data.semester?.name} ({data.section?.name || 'Section'})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() => onNavigate('qr-scanner')}
            className="gap-2 bg-indigo-500 hover:bg-indigo-400 text-white font-bold"
          >
            <QrCode className="w-4 h-4" /> Scan Attendance QR
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('my-attendance')}
            className="gap-1.5 border-slate-700 bg-white/10 hover:bg-white/20 text-white text-xs"
          >
            Full Log <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Defaulter Warning Banner */}
      {!isEligible && data.summary.total > 0 && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-bold text-rose-900 uppercase tracking-wider block">
              Academic Attendance Defaulter Warning
            </span>
            <p className="text-xs text-rose-800 mt-0.5">
              Your overall attendance is currently at <strong>{data.summary.percentage}%</strong>, which is below the mandatory university threshold of 75%. You must attend at least <strong>{data.neededClassesToRecover} consecutive classes</strong> to restore examination eligibility.
            </p>
          </div>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Overall Attendance"
          value={`${data.summary.percentage}%`}
          icon={<CheckCircle2 className="w-5 h-5 text-indigo-600" />}
          subtitle={`${data.summary.present} of ${data.summary.total} classes`}
          badge={{
            text: isEligible ? 'In Good Standing' : 'Defaulter',
            variant: isEligible ? 'success' : 'danger',
          }}
        />
        <StatCard
          title="Attended Classes"
          value={data.summary.present}
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          subtitle="Full lecture credit"
          badge={{ text: 'Present', variant: 'success' }}
        />
        <StatCard
          title="Unexcused Absences"
          value={data.summary.absent}
          icon={<XCircle className="w-5 h-5 text-rose-600" />}
          subtitle="Missed academic sessions"
          badge={{ text: `${data.summary.absent} Missed`, variant: 'danger' }}
        />
        <StatCard
          title="Tardy / Late"
          value={data.summary.late}
          icon={<Clock className="w-5 h-5 text-amber-600" />}
          subtitle="Counted as present"
          badge={{ text: 'Full credit', variant: 'warning' }}
        />
      </div>

      {/* Main Grid: Subject Breakdown & Today's Schedule */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Subject-Wise Attendance Breakdown */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle>Course-Wise Attendance Breakdown</CardTitle>
              <CardDescription>Detailed compliance per registered academic subject</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate('my-history')}
            >
              Session History
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.subjectBreakdown.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No attendance records recorded yet.
              </div>
            ) : (
              data.subjectBreakdown.map((sub: any) => {
                const subEligible = sub.percentage >= 75;

                return (
                  <div
                    key={sub.id}
                    className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                            {sub.code}
                          </span>
                          <h4 className="text-sm font-bold text-slate-900">{sub.name}</h4>
                        </div>
                        <span className="text-[11px] text-slate-500 mt-0.5 block">
                          {sub.credits != null ? `${sub.credits} Credits • ` : ''}{sub.type ? `${sub.type} Course` : ''}
                        </span>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <span className={`text-sm font-bold ${subEligible ? 'text-slate-900' : 'text-rose-600'}`}>
                            {sub.percentage}%
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            ({sub.present}P / {sub.absent}A / {sub.late}L)
                          </span>
                        </div>
                        <Badge variant={subEligible ? 'success' : 'danger'}>
                          {subEligible ? 'Normal' : 'Low'}
                        </Badge>
                      </div>
                    </div>

                    <ProgressBar
                      value={sub.percentage}
                      size="sm"
                      colorScheme={subEligible ? 'emerald' : 'rose'}
                    />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Today's Schedule for Student */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle>{data.todayName} Classes</CardTitle>
            <CardDescription>Scheduled lectures for Section {data.section?.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 flex-1 overflow-y-auto">
            {data.todayClasses.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No classes scheduled for today.
              </div>
            ) : (
              data.todayClasses.map((slot: any) => (
                <div
                  key={slot.id}
                  className="p-3 rounded-lg border border-slate-100 bg-white hover:border-indigo-200 transition-all space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-indigo-700">
                      {slot.subjectCode}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {slot.startTime}–{slot.endTime}
                    </span>
                  </div>
                  <h5 className="text-xs font-bold text-slate-900 line-clamp-1">
                    {slot.subjectName}
                  </h5>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>{slot.teacherName}</span>
                    <Badge variant="outline">{slot.room}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
