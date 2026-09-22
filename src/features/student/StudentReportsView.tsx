import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { studentService } from '../../services/studentService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  FileText,
  Award,
  TrendingUp,
  Calendar,
  AlertCircle,
  Download,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';

export const StudentReportsView: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadReport = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const student = await studentService.getCurrentStudent(user);
        if (student) {
          const res = await studentService.getMyAttendance(student.id);
          setData(res);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadReport();
  }, [user]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400 text-sm">
        Generating your academic attendance report...
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={<FileText className="w-8 h-8" />}
        title="Report Not Available"
        description="Could not generate report for the active student profile."
      />
    );
  }

  const { student, overallPercentage, totalClasses, totalPresent, totalAbsent, totalLate, examEligibility, subjects } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Personal Attendance Report</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Institutional compliance summary for {student.name} ({student.studentId})
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5 self-start sm:self-auto"
          onClick={() => window.print()}
        >
          <Download className="w-3.5 h-3.5" /> Print / Save PDF
        </Button>
      </div>

      {/* Compliance Overview Card */}
      <Card className="border-indigo-100 bg-slate-50/50">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">Semester Examination Status</span>
              <h3 className="text-2xl font-bold text-slate-900">
                {examEligibility === 'eligible' ? 'Permit Cleared for Exams' : 'Attendance Shortage Warning'}
              </h3>
              <p className="text-xs text-slate-600 max-w-xl">
                The institutional standard requires a minimum of 75% attendance across enrolled modules. Your current cumulative rate is{' '}
                <strong className="text-slate-900">{overallPercentage}%</strong>.
              </p>
            </div>

            <div className="text-right shrink-0">
              <div className="text-4xl font-mono font-bold text-slate-900">{overallPercentage}%</div>
              <Badge variant={overallPercentage >= 75 ? 'success' : 'danger'} className="mt-1">
                {overallPercentage >= 75 ? 'Satisfactory' : 'Action Required'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Module Breakdown Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Curriculum Module Compliance</CardTitle>
          <CardDescription>
            Individual module breakdown showing required attendance and current standings
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-slate-100">
            {subjects.map((sub: any) => (
              <div key={sub.subjectId} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/60 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">{sub.subjectName}</span>
                    <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                      {sub.subjectCode}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {sub.present} Attended • {sub.absent} Missed • {sub.late} Tardy • {sub.total} Total Classes
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 sm:w-64">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-500">Rate</span>
                      <span className="font-mono font-bold text-slate-900">{sub.percentage}%</span>
                    </div>
                    <ProgressBar value={sub.percentage} colorScheme={sub.percentage >= 75 ? 'emerald' : 'rose'} />
                  </div>
                  <Badge variant={sub.percentage >= 75 ? 'success' : 'danger'}>
                    {sub.percentage >= 75 ? 'Clear' : 'Deficit'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
