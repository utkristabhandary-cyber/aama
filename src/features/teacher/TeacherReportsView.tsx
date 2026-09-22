import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { teacherService } from '../../services/teacherService';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  FileText,
  BookOpen,
  Users,
  Layers,
  ChevronDown,
  ChevronRight,
  Download,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

export const TeacherReportsView: React.FC = () => {
  const { user } = useAuth();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});

  const loadReports = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const teacher = await teacherService.getCurrentTeacher(user);
      if (teacher) {
        const data = await teacherService.getTeacherReports(teacher.id);
        setReports(data);
        // Expand first class by default
        if (data.length > 0) {
          setExpandedClasses({ [data[0].classId]: true });
        }
      }
    } catch (err) {
      console.error('Error loading teacher reports', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [user]);

  const toggleExpand = (classId: string) => {
    setExpandedClasses(prev => ({ ...prev, [classId]: !prev[classId] }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Faculty Attendance Reports</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Attendance analytics scoped hierarchically to your assigned modules and combined lecture cohorts
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5 self-start sm:self-auto"
          onClick={() => window.print()}
        >
          <Download className="w-3.5 h-3.5" /> Export PDF Report
        </Button>
      </div>

      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400">
          Generating module attendance reports...
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-8 h-8" />}
          title="No Teaching Reports Found"
          description="No completed attendance sessions found for your active teaching assignments."
        />
      ) : (
        <div className="space-y-4">
          {reports.map(item => {
            const isExpanded = !!expandedClasses[item.classId];
            const sectionNames = item.sections.map((s: any) => s.name).join(' + ');

            return (
              <Card key={item.classId} className="overflow-hidden">
                <CardHeader
                  className="cursor-pointer hover:bg-slate-50/60 transition-colors pb-4"
                  onClick={() => toggleExpand(item.classId)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-indigo-50 text-indigo-700 mt-0.5">
                        <BookOpen className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                            {item.subject?.code}
                          </span>
                          <span className="font-bold text-slate-900 text-base">{item.subject?.name}</span>
                          <Badge variant="outline">{item.classType}</Badge>
                          {item.isCombined && (
                            <Badge variant="warning" className="gap-1">
                              <Layers className="w-3 h-3" /> Section {sectionNames} (Combined)
                            </Badge>
                          )}
                          {!item.isCombined && (
                            <Badge variant="default">Section {sectionNames}</Badge>
                          )}
                        </div>

                        <p className="text-xs text-slate-500 mt-1">
                          {item.semester?.name} • {item.studentMetrics.length} Enrolled Students • {item.sessionCount} Recorded Sessions
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <span className="text-xs text-slate-400 block">Class Average</span>
                        <span className="text-lg font-bold font-mono text-slate-900">{item.averagePercentage}%</span>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 border-t border-slate-100 p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="px-5 py-3">Student Name</th>
                            <th className="px-5 py-3">Roll & ID</th>
                            <th className="px-5 py-3">Section</th>
                            <th className="px-5 py-3 text-center">Attended Sessions</th>
                            <th className="px-5 py-3 text-right">Attendance %</th>
                            <th className="px-5 py-3 text-center">Eligibility</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {item.studentMetrics.map((stu: any) => (
                            <tr key={stu.studentId} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-5 py-3 font-bold text-slate-900">{stu.name}</td>
                              <td className="px-5 py-3 font-mono text-slate-600">
                                Roll #{stu.rollNo} • {stu.studentCode}
                              </td>
                              <td className="px-5 py-3">
                                <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] font-semibold">
                                  {stu.sectionName}
                                </span>
                              </td>
                              <td className="px-5 py-3 text-center font-mono font-semibold text-slate-800">
                                {stu.attendedSessions} / {stu.totalSessions || item.sessionCount}
                              </td>
                              <td className="px-5 py-3 text-right font-mono font-bold">
                                <span className={stu.percentage >= 75 ? 'text-emerald-600' : 'text-rose-600'}>
                                  {stu.percentage}%
                                </span>
                              </td>
                              <td className="px-5 py-3 text-center">
                                <Badge variant={stu.percentage >= 75 ? 'success' : 'danger'}>
                                  {stu.status}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
