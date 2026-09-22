import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { studentService } from '../../services/studentService';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ClipboardList } from 'lucide-react';

function toClock(value: string | null): string {
  return value ? value.slice(0, 5) : '';
}

export const StudentAttendanceHistoryView: React.FC = () => {
  const { user } = useAuth();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadHistory = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const student = await studentService.getCurrentStudent(user);
        if (!student) return;

        // Authoritative per-session log from the backend student self-endpoint.
        const attendance = await studentService.getMyAttendance(student.id);
        setHistory(
          attendance.logs.map(log => ({
            id: log.attendanceSessionId,
            date: log.sessionDate,
            time: `${toClock(log.startTime)}–${toClock(log.endTime)}`,
            subjectName: log.subjectName,
            subjectCode: log.subjectCode,
            teacherName: log.teacherName,
            status: log.status,
            notes: log.notes || '',
          }))
        );
      } catch (err) {
        console.error('Failed loading attendance history', err);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Attendance Session Records</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Audited log of roll calls recorded by faculty across your enrolled courses
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Date & Time</th>
                  <th className="px-5 py-3">Course / Subject</th>
                  <th className="px-5 py-3">Instructor</th>
                  <th className="px-5 py-3">Class Log</th>
                  <th className="px-5 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      Loading your attendance records...
                    </td>
                  </tr>
                ) : history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8">
                      <EmptyState
                        icon={<ClipboardList className="w-6 h-6" />}
                        title="No attendance sessions recorded"
                        description="As your teachers take roll call, your session records will appear here."
                      />
                    </td>
                  </tr>
                ) : (
                  history.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 font-medium text-slate-900 whitespace-nowrap">
                        {item.date}
                        <span className="text-slate-400 font-mono text-[11px] block">{item.time}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-slate-900">{item.subjectName}</div>
                        <div className="text-[11px] text-indigo-600 font-mono font-semibold">{item.subjectCode}</div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-700">{item.teacherName}</td>
                      <td className="px-5 py-3.5 text-slate-500 max-w-xs truncate">
                        {item.notes || '—'}
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <Badge
                          variant={
                            item.status === 'present'
                              ? 'success'
                              : item.status === 'absent'
                              ? 'danger'
                              : 'warning'
                          }
                        >
                          {item.status.toUpperCase()}
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
    </div>
  );
};
