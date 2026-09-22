import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { reportService } from '../../services/reportService';
import { ApiAdminAnalytics } from '../../types/api';
import { useToast } from '../../context/ToastContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Tabs } from '../../components/ui/Tabs';
import { ProgressBar } from '../../components/ui/ProgressBar';
import {
  BarChart3,
  Download,
  AlertTriangle,
  Users,
  BookOpen,
  CheckCircle2,
  TrendingDown,
  Mail,
  FileSpreadsheet,
} from 'lucide-react';

export const ReportsView: React.FC = () => {
  const [analytics, setAnalytics] = useState<ApiAdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [selectedSemester, setSelectedSemester] = useState('all');
  const [selectedSection, setSelectedSection] = useState('all');
  const [selectedSubject, setSelectedSubject] = useState('all');
  const [reportTab, setReportTab] = useState<'students' | 'subjects' | 'defaulters'>('students');

  const { showToast } = useToast();

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAnalytics(await reportService.getAdminAnalytics());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load institutional analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Filter options are derived from the live payload (no secondary lookups).
  const semesters = useMemo(() => {
    if (!analytics) return [];
    const map = new Map<number, string>();
    analytics.bySubject.forEach(s => map.set(s.semesterId, s.semesterName));
    analytics.studentRoster.forEach(s => {
      if (s.semesterId !== null) map.set(s.semesterId, s.semesterName || '');
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [analytics]);

  const sections = useMemo(() => {
    if (!analytics) return [];
    const map = new Map<number, string>();
    analytics.studentRoster.forEach(s => {
      if (s.sectionId !== null) map.set(s.sectionId, s.sectionName || '');
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [analytics]);

  const studentReports = useMemo(() => {
    if (!analytics) return [];
    let list = analytics.studentRoster;
    if (selectedSemester !== 'all') {
      list = list.filter(s => String(s.semesterId) === selectedSemester);
    }
    if (selectedSection !== 'all') {
      list = list.filter(s => String(s.sectionId) === selectedSection);
    }

    return list.map(stu => ({
      id: stu.studentId,
      studentId: stu.studentCode,
      rollNo: stu.rollNo,
      name: stu.name,
      guardianName: stu.guardianName,
      guardianPhone: stu.guardianPhone,
      semesterId: stu.semesterId,
      semesterName: stu.semesterName || '',
      sectionName: stu.sectionName || '',
      total: stu.marked,
      present: stu.present,
      absent: stu.absent,
      late: stu.late,
      percentage: stu.percentage === null ? 0 : stu.percentage,
      hasAttendance: stu.marked > 0,
      isDefaulter: stu.percentage !== null && stu.percentage < 75,
    }));
  }, [analytics, selectedSemester, selectedSection]);

  const subjectReports = useMemo(() => {
    if (!analytics) return [];
    let list = analytics.bySubject;
    if (selectedSemester !== 'all') {
      list = list.filter(s => String(s.semesterId) === selectedSemester);
    }
    if (selectedSubject !== 'all') {
      list = list.filter(s => String(s.subjectId) === selectedSubject);
    }

    return list.map(sub => ({
      id: sub.subjectId,
      code: sub.subjectCode,
      name: sub.subjectName,
      semesterId: sub.semesterId,
      semesterName: sub.semesterName,
      credits: sub.credits,
      sessionsCount: sub.sessions,
      percentage: sub.percentage,
    }));
  }, [analytics, selectedSemester, selectedSubject]);

  const auditedStudents = useMemo(() => studentReports.filter(s => s.hasAttendance), [studentReports]);

  const defaulters = useMemo(() => studentReports.filter(s => s.isDefaulter), [studentReports]);

  // Campus aggregate over students with at least one marking; unmarked
  // students are excluded so an empty institution never reads as 0%.
  const aggregatePercentage = useMemo(() => {
    if (!analytics) return 0;
    const scored = analytics.studentRoster.filter(r => r.percentage !== null);
    if (scored.length === 0) return 0;
    return Math.round(scored.reduce((acc, r) => acc + (r.percentage || 0), 0) / scored.length);
  }, [analytics]);

  // CSV Export Handler
  const handleExportCSV = () => {
    const csvContent = reportService.exportAttendanceReportCSV(studentReports);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `AAMS_Attendance_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast({ title: 'Report Downloaded', description: 'Exported CSV to your local device.', type: 'success' });
  };

  const handleNotifyDefaulter = (studentName: string) => {
    showToast({
      title: 'Notice Dispatch Unavailable',
      description: `Guardian notice dispatch for ${studentName} is handled outside the web portal. No change has been made.`,
      type: 'warning',
    });
  };

  return (
    <div className="space-y-6">
      {loading && (
        <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-700">
          Loading institutional analytics from the live backend…
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between gap-3">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => loadAnalytics()}>
            Retry
          </Button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Attendance Analytics & Reports</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Institutional cohorts, subject breakdowns, compliance monitoring, and CSV exports
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          leftIcon={<FileSpreadsheet className="w-4 h-4" />}
          onClick={handleExportCSV}
        >
          Export CSV Report
        </Button>
      </div>

      {/* Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Overall Attendance
          </span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">
            {aggregatePercentage}%
          </p>
          <div className="mt-2">
            <ProgressBar value={aggregatePercentage} size="sm" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Total Students Audited
          </span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">
            {auditedStudents.length}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block">Students with attendance on record</span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Above 75% Standard
          </span>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1">
            {auditedStudents.length - defaulters.length}
          </p>
          <span className="text-[11px] text-emerald-600 mt-1 block">Eligible for examinations</span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Attendance Defaulters (&lt;75%)
          </span>
          <p className="text-2xl font-extrabold text-rose-600 mt-1">
            {defaulters.length}
          </p>
          <span className="text-[11px] text-rose-500 mt-1 block">Require academic intervention</span>
        </div>
      </div>

      {/* Filter and Tab Navigation Bar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <Tabs
          activeTab={reportTab}
          onChange={val => setReportTab(val as any)}
          tabs={[
            { id: 'students', label: 'Student-Wise Roster', count: studentReports.length },
            { id: 'subjects', label: 'Subject / Course Ratios', count: subjectReports.length },
            { id: 'defaulters', label: 'Low Attendance Defaulters', count: defaulters.length },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedSemester}
            onChange={e => setSelectedSemester(e.target.value)}
            className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
          >
            <option value="all">All Semesters</option>
            {semesters.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <select
            value={selectedSection}
            onChange={e => setSelectedSection(e.target.value)}
            className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
          >
            <option value="all">All Sections</option>
            {sections.map(sec => (
              <option key={sec.id} value={sec.id}>{sec.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab 1: Student Roster */}
      {reportTab === 'students' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3">Roll</th>
                    <th className="px-5 py-3">Student Name</th>
                    <th className="px-5 py-3">ID Number</th>
                    <th className="px-5 py-3">Section</th>
                    <th className="px-5 py-3">Total Classes</th>
                    <th className="px-5 py-3">Present</th>
                    <th className="px-5 py-3">Absent</th>
                    <th className="px-5 py-3">Percentage</th>
                    <th className="px-5 py-3">Exam Eligibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {studentReports.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-xs text-slate-400">
                        No students match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    studentReports.map(stu => (
                    <tr key={stu.id} className="hover:bg-slate-50/80">
                      <td className="px-5 py-3.5 font-mono font-bold text-slate-700">{stu.rollNo}</td>
                      <td className="px-5 py-3.5 font-bold text-slate-900">{stu.name}</td>
                      <td className="px-5 py-3.5 font-mono text-slate-500">{stu.studentId}</td>
                      <td className="px-5 py-3.5">{stu.sectionName}</td>
                      <td className="px-5 py-3.5 font-semibold text-slate-800">{stu.total}</td>
                      <td className="px-5 py-3.5 text-emerald-700 font-medium">{stu.present}</td>
                      <td className="px-5 py-3.5 text-rose-700 font-medium">{stu.absent}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-bold ${
                              stu.hasAttendance
                                ? stu.percentage < 75
                                  ? 'text-rose-600'
                                  : 'text-slate-900'
                                : 'text-slate-400'
                            }`}
                          >
                            {stu.hasAttendance ? `${stu.percentage}%` : '—'}
                          </span>
                          {stu.hasAttendance && (
                            <div className="w-14">
                              <ProgressBar
                                value={stu.percentage}
                                size="sm"
                                colorScheme={stu.percentage < 75 ? 'rose' : 'emerald'}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge
                          variant={!stu.hasAttendance ? 'default' : stu.percentage >= 75 ? 'success' : 'danger'}
                        >
                          {!stu.hasAttendance ? 'No Data' : stu.percentage >= 75 ? 'Eligible' : 'At Risk'}
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
      )}

      {/* Tab 2: Subject Breakdown */}
      {reportTab === 'subjects' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-5 py-3">Course Code</th>
                    <th className="px-5 py-3">Subject Name</th>
                    <th className="px-5 py-3">Semester</th>
                    <th className="px-5 py-3">Credits</th>
                    <th className="px-5 py-3">Sessions Conducted</th>
                    <th className="px-5 py-3">Cohort Attendance Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subjectReports.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-xs text-slate-400">
                        No subject attendance data recorded for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    subjectReports.map(sub => (
                    <tr key={sub.id} className="hover:bg-slate-50/80">
                      <td className="px-5 py-3.5 font-mono font-bold text-indigo-700">{sub.code}</td>
                      <td className="px-5 py-3.5 font-bold text-slate-900">{sub.name}</td>
                      <td className="px-5 py-3.5 text-slate-600">{sub.semesterName}</td>
                      <td className="px-5 py-3.5 font-semibold text-slate-800">{sub.credits} Credits</td>
                      <td className="px-5 py-3.5 font-mono font-medium text-slate-800">{sub.sessionsCount} Sessions</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">{sub.percentage}%</span>
                          <div className="w-24">
                            <ProgressBar value={sub.percentage} size="sm" />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tab 3: Defaulters */}
      {reportTab === 'defaulters' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-rose-900">
                Institutional 75% Attendance Compliance Rule
              </h4>
              <p className="text-xs text-rose-800 mt-0.5">
                Students below 75% are ineligible for final semester examinations under university regulations. Dispatch notices directly to guardians.
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-5 py-3">Roll</th>
                      <th className="px-5 py-3">Student Name</th>
                      <th className="px-5 py-3">Student ID</th>
                      <th className="px-5 py-3">Section</th>
                      <th className="px-5 py-3">Attended / Total</th>
                      <th className="px-5 py-3">Percentage</th>
                      <th className="px-5 py-3">Guardian Contact</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {defaulters.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-xs text-slate-400">
                          No students are currently below the 75% attendance threshold!
                        </td>
                      </tr>
                    ) : (
                      defaulters.map(stu => (
                        <tr key={stu.id} className="hover:bg-rose-50/40">
                          <td className="px-5 py-3.5 font-mono font-bold text-slate-700">{stu.rollNo}</td>
                          <td className="px-5 py-3.5 font-bold text-slate-900">{stu.name}</td>
                          <td className="px-5 py-3.5 font-mono text-slate-500">{stu.studentId}</td>
                          <td className="px-5 py-3.5">{stu.sectionName}</td>
                          <td className="px-5 py-3.5 font-medium text-slate-800">
                            {stu.present} / {stu.total}
                          </td>
                          <td className="px-5 py-3.5 font-bold text-rose-600">
                            {stu.percentage}%
                          </td>
                          <td className="px-5 py-3.5 text-slate-600">
                            <div>{stu.guardianName}</div>
                            <div className="text-[11px] text-slate-400 font-mono">{stu.guardianPhone}</div>
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50 text-xs"
                              leftIcon={<Mail className="w-3.5 h-3.5 text-rose-600" />}
                              onClick={() => handleNotifyDefaulter(stu.name)}
                            >
                              Dispatch Notice
                            </Button>
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
      )}
    </div>
  );
};
