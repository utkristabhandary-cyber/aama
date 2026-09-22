import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { studentService } from '../../services/studentService';
import { semesterService } from '../../services/semesterService';
import { subjectService } from '../../services/subjectService';
import { Semester } from '../../types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Select } from '../../components/ui/Select';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  CheckCircle2,
  XCircle,
  Clock,
  BookOpen,
  Award,
} from 'lucide-react';

function toClock(value: string | null): string {
  return value ? value.slice(0, 5) : '';
}

export const StudentAttendanceView: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [selectedSemesterId, setSelectedSemesterId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [semesters, setSemesters] = useState<Semester[]>([]);

  useEffect(() => {
    semesterService
      .getSemesters()
      .then(setSemesters)
      .catch(err => console.error('Failed loading semesters', err));
  }, []);

  useEffect(() => {
    const loadAttendance = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const student = await studentService.getCurrentStudent(user);
        if (student) {
          const [attendance, allSubjects] = await Promise.all([
            studentService.getMyAttendance(student.id, {
              semesterId: selectedSemesterId || undefined,
              subjectId: selectedSubjectId || undefined,
            }),
            subjectService.getSubjects().catch(() => []),
          ]);
          const creditsById = new Map<string, number>(
            allSubjects.map((s): [string, number] => [s.id, s.credits])
          );

          // Present counts both present and late server-side; absent is derived.
          setData({
            student: {
              name: attendance.student.name,
              studentId: attendance.student.student_id,
            },
            overallPercentage: Math.round(attendance.overallPercentage),
            totalClasses: attendance.overallTotal,
            totalPresent: attendance.overallPresent,
            totalAbsent: attendance.overallTotal - attendance.overallPresent,
            totalLate: 0,
            examEligibility: attendance.overallPercentage >= 75 ? 'eligible' : 'shortage',
            subjects: attendance.subjects.map(sub => ({
              subjectId: String(sub.subjectId),
              subjectCode: sub.subjectCode,
              subjectName: sub.subjectName,
              credits: creditsById.get(String(sub.subjectId)),
              present: sub.present,
              absent: sub.total - sub.present,
              late: 0,
              total: sub.total,
              percentage: Math.round(sub.percentage),
            })),
            logs: attendance.logs.map(log => ({
              sessionId: log.attendanceSessionId,
              date: log.sessionDate,
              time: `${toClock(log.startTime)}–${toClock(log.endTime)}`,
              subjectName: log.subjectName,
              subjectCode: log.subjectCode,
              classType: log.classType,
              teacherName: log.teacherName,
              status: log.status,
              notes: log.notes || '',
            })),
          });
        }
      } catch (err) {
        console.error('Failed loading student attendance', err);
      } finally {
        setLoading(false);
      }
    };

    loadAttendance();
  }, [user, selectedSemesterId, selectedSubjectId]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400 text-sm">
        Loading your attendance records...
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={<BookOpen className="w-8 h-8" />}
        title="Student Profile Not Found"
        description="Could not locate enrolled student profile records for your account."
      />
    );
  }

  const { student, overallPercentage, totalClasses, totalPresent, totalAbsent, totalLate, examEligibility, subjects, logs } = data;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">My Attendance</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Personal attendance tracking for {student.name} ({student.studentId})
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="w-44">
            <Select
              value={selectedSemesterId}
              onChange={e => setSelectedSemesterId(e.target.value)}
              options={[
                { value: '', label: 'All Semesters' },
                ...semesters.map(s => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <div className="w-48">
            <Select
              value={selectedSubjectId}
              onChange={e => setSelectedSubjectId(e.target.value)}
              options={[
                { value: '', label: 'All Subjects' },
                ...subjects.map((sub: any) => ({ value: sub.subjectId, label: sub.subjectCode || sub.subjectName })),
              ]}
            />
          </div>
        </div>
      </div>

      {/* Summary KPI Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-indigo-100 bg-gradient-to-br from-white to-indigo-50/40">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Overall Attendance</span>
              <Award className={`w-5 h-5 ${overallPercentage >= 75 ? 'text-emerald-500' : 'text-amber-500'}`} />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono text-slate-900">{overallPercentage}%</span>
              <Badge variant={overallPercentage >= 75 ? 'success' : 'danger'}>
                {examEligibility === 'eligible' ? 'Exam Eligible' : 'Shortage Warning'}
              </Badge>
            </div>
            <div className="mt-3">
              <ProgressBar value={overallPercentage} colorScheme={overallPercentage >= 75 ? 'emerald' : 'rose'} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Present Markings</span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono text-emerald-600">{totalPresent}</span>
              <span className="text-xs text-slate-400">/ {totalClasses} classes</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Full attendance credit
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Absent Classes</span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono text-rose-600">{totalAbsent}</span>
              <span className="text-xs text-slate-400">missed</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5 text-rose-500" /> Need 75% for exam permit
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Late Arrivals</span>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono text-amber-600">{totalLate}</span>
              <span className="text-xs text-slate-400">tardy</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-amber-500" /> Calculated at 50% credit
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Subject-Wise Breakdown Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Subject Attendance Breakdown</CardTitle>
          <CardDescription>
            Official course roll call breakdown evaluated against the institutional 75% mandatory threshold
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-y border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Subject / Module</th>
                  <th className="px-5 py-3 text-center">Present</th>
                  <th className="px-5 py-3 text-center">Absent</th>
                  <th className="px-5 py-3 text-center">Late</th>
                  <th className="px-5 py-3 text-center">Total Classes</th>
                  <th className="px-5 py-3 text-right">Attendance %</th>
                  <th className="px-5 py-3 text-center">Permit Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subjects.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      No subject enrollment found for selected filters.
                    </td>
                  </tr>
                ) : (
                  subjects.map((sub: any) => (
                    <tr key={sub.subjectId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-slate-900">{sub.subjectName}</div>
                        <div className="text-[11px] text-indigo-600 font-mono font-semibold">{sub.subjectCode}{sub.credits != null ? ` • ${sub.credits} Credits` : ''}</div>
                      </td>
                      <td className="px-5 py-3.5 text-center font-mono font-semibold text-emerald-600">
                        {sub.present}
                      </td>
                      <td className="px-5 py-3.5 text-center font-mono font-semibold text-rose-600">
                        {sub.absent}
                      </td>
                      <td className="px-5 py-3.5 text-center font-mono font-semibold text-amber-600">
                        {sub.late}
                      </td>
                      <td className="px-5 py-3.5 text-center font-mono text-slate-600">
                        {sub.total}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono font-bold">
                        <span className={sub.percentage >= 75 ? 'text-emerald-600' : 'text-rose-600'}>
                          {sub.percentage}%
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <Badge variant={sub.percentage >= 75 ? 'success' : 'danger'}>
                          {sub.percentage >= 75 ? 'Clear' : 'Shortage'}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Session Log History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Roll Call History</CardTitle>
          <CardDescription>
            Chronological log of lecture sessions and recorded attendance for your section
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-y border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Date & Time</th>
                  <th className="px-5 py-3">Module</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Instructor</th>
                  <th className="px-5 py-3 text-center">My Status</th>
                  <th className="px-5 py-3">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No attendance session logs recorded yet.
                    </td>
                  </tr>
                ) : (
                  logs.slice(0, 15).map((log: any) => (
                    <tr key={log.sessionId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-slate-900 whitespace-nowrap">
                        {log.date}
                        <span className="text-slate-400 font-mono text-[11px] block">{log.time}</span>
                      </td>
                      <td className="px-5 py-3 font-semibold text-slate-900">
                        {log.subjectName}
                        <span className="text-[11px] text-slate-400 block font-normal">{log.subjectCode}</span>
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant="outline">{log.classType}</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-700">{log.teacherName}</td>
                      <td className="px-5 py-3 text-center">
                        <Badge
                          variant={
                            log.status === 'present'
                              ? 'success'
                              : log.status === 'absent'
                              ? 'danger'
                              : 'warning'
                          }
                        >
                          {log.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-500 truncate max-w-xs">{log.notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
