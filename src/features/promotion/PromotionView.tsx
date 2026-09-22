import React, { useState, useEffect, useCallback } from 'react';
import { Semester, Section, Student } from '../../types';
import { useToast } from '../../context/ToastContext';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { studentService } from '../../services/studentService';
import { reportService } from '../../services/reportService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import {
  ArrowRight,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

export const PromotionView: React.FC = () => {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  // Server-computed attendance percentage per student (from /reports/admin/).
  // A missing entry means the student has no attendance data yet — it is shown
  // as "—" instead of a made-up number.
  const [rosterPercentages, setRosterPercentages] = useState<Map<string, number | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Wizard state
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fromSemesterId, setFromSemesterId] = useState('');
  const [fromSectionId, setFromSectionId] = useState('');
  const [toSemesterId, setToSemesterId] = useState('');
  const [toSectionId, setToSectionId] = useState('');

  // Selected student IDs for promotion
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);

  const { showToast } = useToast();

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [semList, secList, stuList, analytics] = await Promise.all([
        semesterService.getSemesters(),
        sectionService.getSections(),
        studentService.getStudents(),
        reportService.getAdminAnalytics(),
      ]);

      const roster = new Map<string, number | null>();
      analytics.studentRoster.forEach(row => {
        roster.set(String(row.studentId), row.percentage != null ? row.percentage : null);
      });

      setSemesters(semList);
      setSections(secList);
      setStudents(stuList);
      setRosterPercentages(roster);

      if (semList.length >= 1) {
        setFromSemesterId(semList[0].id);
        const fromSecs = secList.filter(s => s.semesterId === semList[0].id);
        if (fromSecs.length > 0) setFromSectionId(fromSecs[0].id);
        if (semList.length >= 2) {
          setToSemesterId(semList[1].id);
          const toSecs = secList.filter(s => s.semesterId === semList[1].id);
          if (toSecs.length > 0) setToSectionId(toSecs[0].id);
        }
      }
    } catch {
      setLoadError('Could not load promotion data. Make sure you are signed in as an administrator and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter students belonging to fromSemester and fromSection
  const candidateStudents = students.filter(s => {
    const matchesSem = s.semesterId === fromSemesterId;
    const matchesSec = fromSectionId ? s.sectionId === fromSectionId : true;
    return matchesSem && matchesSec;
  });

  // Select all candidate students when the cohort changes
  useEffect(() => {
    setSelectedStudentIds(candidateStudents.map(s => s.id));
  }, [fromSemesterId, fromSectionId, students]);

  const handleToggleStudent = (id: string) => {
    setSelectedStudentIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectEligibleOnly = () => {
    const eligible = candidateStudents
      .filter(s => {
        const pct = rosterPercentages.get(s.id);
        return pct != null && pct >= 75;
      })
      .map(s => s.id);
    setSelectedStudentIds(eligible);
    showToast({
      title: 'Eligible Students Filtered',
      description: `Selected ${eligible.length} students meeting the 75% attendance threshold (from live records).`,
      type: 'info',
    });
  };

  const handleSelectAll = () => {
    setSelectedStudentIds(candidateStudents.map(s => s.id));
  };

  const sourceSemester = semesters.find(s => s.id === fromSemesterId);
  const targetSemester = semesters.find(s => s.id === toSemesterId);
  const sourceSection = sections.find(s => s.id === fromSectionId);
  const targetSection = sections.find(s => s.id === toSectionId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Student Promotion Management</h2>
          <p className="text-xs text-slate-500 mt-0.5">Loading live cohorts and attendance records…</p>
        </div>
        <div className="animate-pulse h-16 bg-slate-100 rounded-xl" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Student Promotion Management</h2>
        </div>
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Promotion data unavailable.</p>
            <p className="mt-1">{loadError}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Student Promotion Management</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Review cohorts for advancement to the next academic semester using live attendance records
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-between max-w-2xl mx-auto p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
        <div className={`flex items-center gap-2 text-xs font-bold ${step >= 1 ? 'text-indigo-600' : 'text-slate-400'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
            1
          </span>
          <span>Cohort Selection</span>
        </div>
        <div className="h-0.5 w-12 bg-slate-200" />
        <div className={`flex items-center gap-2 text-xs font-bold ${step >= 2 ? 'text-indigo-600' : 'text-slate-400'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
            2
          </span>
          <span>Roster Verification</span>
        </div>
        <div className="h-0.5 w-12 bg-slate-200" />
        <div className={`flex items-center gap-2 text-xs font-bold ${step >= 3 ? 'text-indigo-600' : 'text-slate-400'}`}>
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 3 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
            3
          </span>
          <span>Final Review</span>
        </div>
      </div>

      {/* Step 1: Select Semesters */}
      {step === 1 && (
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Select Source & Target Cohorts</CardTitle>
            <CardDescription>
              Specify which cohort to promote from, and their destination semester & section
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Source */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                  Source Cohort (Current)
                </span>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Semester</label>
                  <select
                    value={fromSemesterId}
                    onChange={e => {
                      const newSem = e.target.value;
                      setFromSemesterId(newSem);
                      const sSecs = sections.filter(s => s.semesterId === newSem);
                      setFromSectionId(sSecs[0]?.id || '');
                    }}
                    className="w-full bg-white text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-medium"
                  >
                    {semesters.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.academicYear})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Section</label>
                  <select
                    value={fromSectionId}
                    onChange={e => setFromSectionId(e.target.value)}
                    className="w-full bg-white text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-medium"
                  >
                    {sections.filter(s => s.semesterId === fromSemesterId).map(sec => (
                      <option key={sec.id} value={sec.id}>{sec.name} ({sec.room})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Destination */}
              <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200 space-y-4">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-700 block">
                  Target Destination (Promoted To)
                </span>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Semester</label>
                  <select
                    value={toSemesterId}
                    onChange={e => {
                      const newSem = e.target.value;
                      setToSemesterId(newSem);
                      const sSecs = sections.filter(s => s.semesterId === newSem);
                      setToSectionId(sSecs[0]?.id || '');
                    }}
                    className="w-full bg-white text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-medium"
                  >
                    {semesters.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.academicYear})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Target Section</label>
                  <select
                    value={toSectionId}
                    onChange={e => setToSectionId(e.target.value)}
                    className="w-full bg-white text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-medium"
                  >
                    {sections.filter(s => s.semesterId === toSemesterId).map(sec => (
                      <option key={sec.id} value={sec.id}>{sec.name} ({sec.room})</option>
                    ))}
                  </select>
                </div>
                {semesters.length < 2 && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Only one semester exists on record. Create the destination semester in the Semesters
                      module before promotion can run — nothing can be advanced yet.
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <Button
                variant="primary"
                size="md"
                rightIcon={<ArrowRight className="w-4 h-4" />}
                onClick={() => setStep(2)}
                disabled={!fromSemesterId || !toSemesterId || fromSemesterId === toSemesterId}
              >
                Proceed to Roster Review
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Student Checklist */}
      {step === 2 && (
        <div className="space-y-4 max-w-4xl mx-auto">
          <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-slate-900 block">
                {candidateStudents.length} Students in {sourceSemester?.name} ({sourceSection?.name})
              </span>
              <span className="text-xs text-slate-500">
                {selectedStudentIds.length} currently selected for advancement
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleSelectAll}>
                Select All
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-xs"
                onClick={handleSelectEligibleOnly}
              >
                Select &ge;75% Attendance Only
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-5 py-3 w-12">
                        <input
                          type="checkbox"
                          checked={selectedStudentIds.length === candidateStudents.length && candidateStudents.length > 0}
                          onChange={e => {
                            if (e.target.checked) handleSelectAll();
                            else setSelectedStudentIds([]);
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </th>
                      <th className="px-5 py-3">Roll</th>
                      <th className="px-5 py-3">Student Name</th>
                      <th className="px-5 py-3">Student ID</th>
                      <th className="px-5 py-3">Attendance %</th>
                      <th className="px-5 py-3">Academic Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidateStudents.map(stu => {
                      const pct = rosterPercentages.get(stu.id);
                      const isSelected = selectedStudentIds.includes(stu.id);

                      return (
                        <tr
                          key={stu.id}
                          className={`hover:bg-slate-50 cursor-pointer ${isSelected ? 'bg-indigo-50/20' : ''}`}
                          onClick={() => handleToggleStudent(stu.id)}
                        >
                          <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleStudent(stu.id)}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="px-5 py-3.5 font-mono font-bold text-slate-700">{stu.rollNo}</td>
                          <td className="px-5 py-3.5 font-bold text-slate-900">{stu.name}</td>
                          <td className="px-5 py-3.5 font-mono text-slate-500">{stu.studentId}</td>
                          <td className="px-5 py-3.5">
                            {pct == null ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <span className={`font-bold ${pct < 75 ? 'text-rose-600' : 'text-emerald-700'}`}>
                                {pct}%
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5">
                            {pct == null ? (
                              <Badge variant="default">No attendance data</Badge>
                            ) : (
                              <Badge variant={pct >= 75 ? 'success' : 'danger'}>
                                {pct >= 75 ? 'Qualified' : 'Attendance Defaulter'}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between pt-4">
            <Button variant="outline" size="sm" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              variant="primary"
              size="md"
              rightIcon={<ArrowRight className="w-4 h-4" />}
              onClick={() => setStep(3)}
              disabled={selectedStudentIds.length === 0}
            >
              Review Summary ({selectedStudentIds.length} Students)
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Final Confirmation */}
      {step === 3 && (
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Confirm Cohort Promotion</CardTitle>
            <CardDescription>
              Review the advancement parameters before executing the promotion
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Source:</span>
                <span className="font-bold text-slate-800">{sourceSemester?.name} • {sourceSection?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Destination:</span>
                <span className="font-bold text-indigo-700">{targetSemester?.name} • {targetSection?.name}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-sm">
                <span>Total Advancing Students:</span>
                <span>{selectedStudentIds.length} Students</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Promotion execution is not available yet.</strong> The backend does not currently
                expose a promotion endpoint, and a student&rsquo;s semester is managed server-side (the field
                is read-only through the API). This review step uses live cohort and attendance data so you
                can plan promotions safely — no student records have been changed.
              </span>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={() => setStep(2)}>
                Back to Selection
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled
                leftIcon={<Sparkles className="w-4 h-4" />}
              >
                Execute Student Promotion
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};