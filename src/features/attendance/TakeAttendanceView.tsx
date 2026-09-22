import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { attendanceService } from '../../services/attendanceService';
import { teacherService, TeacherClassItem } from '../../services/teacherService';
import { sectionService } from '../../services/sectionService';
import { holidayService } from '../../services/holidayService';
import { AttendanceStatus, Teacher, Section } from '../../types';
import { ApiRollStudent } from '../../types/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { EmptyState } from '../../components/ui/EmptyState';
import { LiveQRPane } from './LiveQRPane';
import {
  AlertTriangle,
  BookOpen,
  ClipboardList,
  Layers,
  QrCode,
  Search,
  Send,
} from 'lucide-react';

export interface TakeAttendanceViewProps {
  preselectedSlotId?: string;
  onFinished?: () => void;
}

interface RosterRow {
  studentId: number;
  studentCode: string;
  name: string;
  rollNo: string;
  sectionId: number | null;
  sectionName: string | null;
  status: AttendanceStatus | null;
}

function toRoster(students: ApiRollStudent[]): RosterRow[] {
  return students.map(s => ({
    studentId: s.studentId,
    studentCode: s.studentCode,
    name: s.studentName,
    rollNo: s.rollNo,
    sectionId: s.sectionId,
    sectionName: s.sectionName,
    status: s.status,
  }));
}

export const TakeAttendanceView: React.FC<TakeAttendanceViewProps> = ({
  preselectedSlotId,
  onFinished,
}) => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [teacher, setTeacher] = useState<Teacher | undefined>();
  const [noTeacher, setNoTeacher] = useState(false);
  const [classes, setClasses] = useState<TeacherClassItem[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  // Selected class/teaching session
  const [selectedTeachingSessionId, setSelectedTeachingSessionId] = useState<string>('');
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [room, setRoom] = useState('Room 204');
  const [sessionNotes, setSessionNotes] = useState('');

  // Live server-authoritative session + roster
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [isSessionFinalized, setIsSessionFinalized] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');

  // Attendance collection mode: manual roll call or secure QR streaming
  // (Phase 6). QR scans write real AttendanceRecords through the backend and
  // show up in the roster like manual marks.
  const [mode, setMode] = useState<'manual' | 'qr'>('manual');

  // Confirmation modal
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Holiday
  const [isHoliday, setIsHoliday] = useState(false);
  const [holidayTitle, setHolidayTitle] = useState('');

  const applyTeachingSession = (classItem: TeacherClassItem) => {
    setSelectedTeachingSessionId(classItem.id);
    setSelectedSectionIds(classItem.sectionIds);
    setSelectedSubjectId(classItem.subjectId);
    if (classItem.session.startTime) setStartTime(classItem.session.startTime);
    if (classItem.session.endTime) setEndTime(classItem.session.endTime);
    if (classItem.session.room) setRoom(classItem.session.room);
  };

  // Load teacher identity, sections, and the assigned classes for the roster UI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await teacherService.getCurrentTeacher(user);
      if (cancelled) return;
      if (!current) {
        setNoTeacher(true);
        return;
      }
      setTeacher(current);
      const [secList, classList] = await Promise.all([
        sectionService.getSections(),
        teacherService.getTeacherClasses(current.id),
      ]);
      if (cancelled) return;
      setSections(secList);
      setClasses(classList);
      const matchClass = preselectedSlotId
        ? classList.find(c => c.id === preselectedSlotId)
        : undefined;
      if (matchClass) applyTeachingSession(matchClass);
      else if (classList[0]) applyTeachingSession(classList[0]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, preselectedSlotId]);

  // Holiday check against the authoritative academics endpoint.
  useEffect(() => {
    let cancelled = false;
    holidayService
      .isHolidayDate(sessionDate)
      .then(h => {
        if (cancelled) return;
        setIsHoliday(!!h);
        setHolidayTitle(h?.title || '');
      })
      .catch(() => {
        if (!cancelled) {
          setIsHoliday(false);
          setHolidayTitle('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionDate]);

  const refreshRoll = async (targetSessionId: number) => {
    const roll = await attendanceService.getRoll(targetSessionId);
    setRoster(toRoster(roll.students));
  };

  // Open (create or resume) the attendance session for the selected class+date
  // and load its server-authoritative roll. Unmarked students have no record.
  const sessionKey = `${selectedSubjectId}|${[...selectedSectionIds].sort().join(',')}|${sessionDate}|${mode}`;
  useEffect(() => {
    if (!teacher || !selectedSubjectId || selectedSectionIds.length === 0) return;
    let cancelled = false;
    setSessionLoading(true);
    setSessionError('');
    (async () => {
      try {
        const sectionIdNums = selectedSectionIds.map(Number);
        const matching = await attendanceService.getSessions({
          subjectId: Number(selectedSubjectId),
        });
        const existing = matching.find(
          s =>
            s.session_date === sessionDate &&
            s.section_ids.some(id => sectionIdNums.includes(id))
        );
        const current = existing
          ? existing
          : await attendanceService.createSession({
              session_date: sessionDate,
              subject: Number(selectedSubjectId),
              phase: mode,
              start_time: startTime,
              planned_end_time: endTime,
              section_ids: sectionIdNums,
            });
        if (cancelled) return;
        setSessionId(current.id);
        setIsSessionFinalized(current.is_finalized);
        const roll = await attendanceService.getRoll(current.id);
        if (cancelled) return;
        setRoster(toRoster(roll.students));
      } catch (err) {
        if (cancelled) return;
        const message = (err as Error).message || 'Could not open the attendance session.';
        setSessionError(message);
        setSessionId(null);
        setRoster([]);
        showToast({ title: 'Session Error', description: message, type: 'danger' });
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionKey, teacher?.id]);

  // While QR roll call is active, poll the server roll so newly scanned
  // students appear live in the roster without manual page refreshes.
  useEffect(() => {
    if (mode !== 'qr' || !sessionId || isSessionFinalized || sessionLoading) return;
    const timer = setInterval(() => {
      void refreshRoll(sessionId).catch(() => {
        /* transient poll failure: keep the last known roster */
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [mode, sessionId, isSessionFinalized, sessionLoading]);

  const handleStatusChange = async (studentId: number, status: AttendanceStatus) => {
    if (!sessionId || isSessionFinalized || sessionLoading) return;
    const prev = roster.find(r => r.studentId === studentId)?.status ?? null;
    setRoster(list =>
      list.map(r => (r.studentId === studentId ? { ...r, status } : r))
    );
    try {
      await attendanceService.markStudent(sessionId, studentId, status);
    } catch (err) {
      setRoster(list =>
        list.map(r => (r.studentId === studentId ? { ...r, status: prev } : r))
      );
      showToast({
        title: 'Mark Failed',
        description: (err as Error).message || 'Could not update this student.',
        type: 'danger',
      });
    }
  };

  const markAll = async (status: AttendanceStatus) => {
    if (!sessionId || isSessionFinalized || roster.length === 0 || sessionLoading) return;
    const prevList = [...roster];
    setRoster(list => list.map(r => ({ ...r, status })));
    try {
      await attendanceService.bulkMarkStudents(
        sessionId,
        roster.map(r => ({ studentId: r.studentId, status })),
      );
      showToast({
        title: `Marked All as ${status.toUpperCase()}`,
        type: status === 'present' ? 'success' : 'info',
      });
    } catch (err) {
      setRoster(prevList);
      showToast({
        title: 'Bulk Mark Failed',
        description: (err as Error).message || 'Could not update the roster.',
        type: 'danger',
      });
    }
  };

  // Metrics (present counts present+late, matching the server summary).
  const stats = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    roster.forEach(r => {
      if (r.status === 'present') present++;
      else if (r.status === 'absent') absent++;
      else if (r.status === 'late') late++;
    });
    return { total: roster.length, present, absent, late };
  }, [roster]);

  const handleSubmitManual = async () => {
    if (isHoliday) {
      showToast({
        title: 'Institutional Holiday',
        description: `Cannot conduct attendance on declared holiday: ${holidayTitle}.`,
        type: 'danger',
      });
      return;
    }
    if (roster.length === 0) {
      showToast({ title: 'Empty Class', description: 'No students to record attendance for.', type: 'danger' });
      return;
    }
    if (!sessionId) {
      showToast({ title: 'No Active Session', description: 'Select a class and date before submitting.', type: 'danger' });
      return;
    }
    const markedIds = roster.filter(r => r.status).map(r => r.studentId);
    if (markedIds.length === 0) {
      showToast({
        title: 'No Attendance Recorded',
        description: 'Mark each student as Present, Absent, or Late before submitting. Unmarked students are not recorded.',
        type: 'danger',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await attendanceService.submitSession(sessionId, {
        markedIds,
        lateReason: sessionNotes || '',
      });
      showToast({
        title: 'Attendance Verified & Submitted',
        description: `Session recorded with ${stats.present} present, ${stats.absent} absent, ${stats.late} late.`,
        type: 'success',
      });
      setIsConfirmModalOpen(false);
      if (onFinished) onFinished();
    } catch (err) {
      showToast({ title: 'Submission Failed', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedSub = classes.find(c => c.id === selectedTeachingSessionId)?.subject;
  const isCombined = selectedSectionIds.length > 1;
  const sectionLabelList = selectedSectionIds
    .map(id => sections.find(s => s.id === id)?.name || id)
    .join(' + ');

  const filteredStudents = roster.filter(r => {
    const matchesSearch =
      r.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      r.studentCode.toLowerCase().includes(searchFilter.toLowerCase()) ||
      r.rollNo.includes(searchFilter);
    const matchesSection = !sectionFilter || String(r.sectionId) === sectionFilter;
    return matchesSearch && matchesSection;
  });

  if (noTeacher) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Conduct Attendance Session</h2>
          <p className="text-xs text-slate-500 mt-0.5">Manual roll call against the live attendance session engine</p>
        </div>
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={<ClipboardList className="w-6 h-6" />}
              title="No teacher profile linked"
              description="Ask an administrator to link your user account to a teacher profile before conducting attendance."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Conduct Attendance Session</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Roll call verification and student records synchronization through the live attendance session engine
          </p>
        </div>

        {/* Mode Indicator: Manual Roll Call vs Live QR (Phase 6) */}
        <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl self-start sm:self-auto">
          <button
            onClick={() => setMode('manual')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              mode === 'manual'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Manual Roll Call
          </button>
          <button
            title="Secure QR roll call with a server-issued rotating code"
            onClick={() => setMode('qr')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
              mode === 'qr' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" /> Live QR
          </button>
        </div>
      </div>

      {/* Holiday Alert */}
      {isHoliday && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-bold text-amber-900 uppercase tracking-wider block">
              Warning: Declared Academic Holiday ({sessionDate})
            </span>
            <p className="text-xs text-amber-800 mt-0.5">
              "{holidayTitle}" is scheduled on this date.
            </p>
          </div>
        </div>
      )}

      {/* Session Error */}
      {sessionError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-bold text-rose-900 uppercase tracking-wider block">
              Could not open attendance session
            </span>
            <p className="text-xs text-rose-800 mt-0.5">{sessionError}</p>
          </div>
        </div>
      )}

      {/* Finalized Session Notice */}
      {isSessionFinalized && (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
          <Layers className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
          <div>
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              Session Already Submitted
            </span>
            <p className="text-xs text-slate-600 mt-0.5">
              Attendance for this class and date has already been finalized and is locked. A new session for the same
              class and date cannot be created.
            </p>
          </div>
        </div>
      )}

      {/* Class Selection & Combined Section Indicator */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600" /> Teaching Class & Lecture Cohort
          </CardTitle>
          <CardDescription>
            Select assigned class. Combined lecture sessions automatically aggregate student rosters across sections.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assigned Teaching Session
              </label>
              <select
                value={selectedTeachingSessionId}
                onChange={e => {
                  const match = classes.find(c => c.id === e.target.value);
                  if (match) applyTeachingSession(match);
                }}
                className="w-full bg-white text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800 font-medium"
              >
                {classes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.subject?.name} ({c.session.classType}) — Sec {c.sectionLabels} {c.isCombined ? '[Combined]' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Session Date</label>
              <Input
                type="date"
                value={sessionDate}
                onChange={e => setSessionDate(e.target.value)}
                className="text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Time Window</label>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="text-xs"
                />
                <span className="text-slate-400 text-xs">to</span>
                <Input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Room / Hall</label>
              <Input
                value={room}
                onChange={e => setRoom(e.target.value)}
                placeholder="e.g. Room 204 or Lecture Hall A"
                className="text-xs"
              />
            </div>
          </div>

          {/* Combined Section Specification Badge Banner */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              {isCombined ? (
                <Badge variant="warning" className="gap-1 font-bold">
                  <Layers className="w-3 h-3" /> Combined Section Lecture
                </Badge>
              ) : (
                <Badge variant="default">Single Section Class</Badge>
              )}
              <span className="text-slate-600 font-medium">
                Sections: <strong className="text-slate-900 font-bold">{sectionLabelList}</strong>
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-slate-500">Total Expected Students:</span>
              <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                {sessionLoading ? '—' : roster.length} Students
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live QR Roll Call (Phase 6) */}
      {mode === 'qr' && sessionId && !isSessionFinalized && (
        <LiveQRPane
          attendanceSessionId={sessionId}
          disabled={!sessionId || sessionLoading}
          onActiveChange={() => {
            if (sessionId) void refreshRoll(sessionId).catch(() => undefined);
          }}
          onCheckedIn={() => {
            if (sessionId) void refreshRoll(sessionId).catch(() => undefined);
          }}
        />
      )}

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Students</span>
          <span className="text-2xl font-bold font-mono text-slate-900 mt-1 block">{stats.total}</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider block">Present</span>
          <span className="text-2xl font-bold font-mono text-emerald-600 mt-1 block">{stats.present}</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-xs font-semibold text-rose-600 uppercase tracking-wider block">Absent</span>
          <span className="text-2xl font-bold font-mono text-rose-600 mt-1 block">{stats.absent}</span>
        </div>
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs">
          <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider block">Late</span>
          <span className="text-2xl font-bold font-mono text-amber-600 mt-1 block">{stats.late}</span>
        </div>
      </div>

      {/* Student Roster & Live Override Table */}
      <Card>
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Student Roll Call Roster</CardTitle>
              <CardDescription>
                Statuses persist to the live session immediately. Unmarked students have no attendance record.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="text-xs text-emerald-700"
                onClick={() => markAll('present')}
                disabled={isSessionFinalized || sessionLoading || roster.length === 0}
              >
                All Present
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs text-rose-700"
                onClick={() => markAll('absent')}
                disabled={isSessionFinalized || sessionLoading || roster.length === 0}
              >
                All Absent
              </Button>
            </div>
          </div>

          {/* Search & Section Filter */}
          <div className="flex flex-col sm:flex-row gap-3 pt-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search students in this session..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                className="pl-9 text-xs"
              />
            </div>
            {isCombined && (
              <div className="w-full sm:w-48">
                <select
                  value={sectionFilter}
                  onChange={e => setSectionFilter(e.target.value)}
                  className="w-full bg-white text-xs border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
                >
                  <option value="">All Participating Sections</option>
                  {selectedSectionIds.map(id => {
                    const sec = sections.find(s => s.id === id);
                    return (
                      <option key={id} value={id}>
                        Section {sec?.name || id}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3 w-16">Roll</th>
                  <th className="px-5 py-3">Student Name</th>
                  <th className="px-5 py-3">Section</th>
                  <th className="px-5 py-3 text-center">Current Status</th>
                  <th className="px-5 py-3 text-right">Quick Override</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessionLoading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      Loading roster from the attendance session...
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      No students found matching your filters.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map(student => {
                    const status = student.status;
                    return (
                      <tr key={student.studentId} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3 font-mono font-bold text-slate-500">
                          {student.rollNo}
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-bold text-slate-900">{student.name}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{student.studentCode}</div>
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                            Sec {student.sectionName || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          {status ? (
                            <Badge
                              variant={
                                status === 'present'
                                  ? 'success'
                                  : status === 'absent'
                                  ? 'danger'
                                  : 'warning'
                              }
                            >
                              {status.toUpperCase()}
                            </Badge>
                          ) : (
                            <Badge variant="default">UNMARKED</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                            <button
                              onClick={() => handleStatusChange(student.studentId, 'present')}
                              disabled={isSessionFinalized}
                              className={`px-2 py-1 rounded text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                                status === 'present'
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-emerald-700'
                              }`}
                            >
                              Present
                            </button>
                            <button
                              onClick={() => handleStatusChange(student.studentId, 'absent')}
                              disabled={isSessionFinalized}
                              className={`px-2 py-1 rounded text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                                status === 'absent'
                                  ? 'bg-rose-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-rose-700'
                              }`}
                            >
                              Absent
                            </button>
                            <button
                              onClick={() => handleStatusChange(student.studentId, 'late')}
                              disabled={isSessionFinalized}
                              className={`px-2 py-1 rounded text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                                status === 'late'
                                  ? 'bg-amber-500 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-amber-700'
                              }`}
                            >
                              Late
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Manual Commit Card */}
      {!isSessionFinalized && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Class Notes / Topic Covered (Optional)
              </label>
              <Input
                placeholder="e.g. Chapter 4: Relational Algebra & SQL Joins covered in lecture"
                value={sessionNotes}
                onChange={e => setSessionNotes(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-500">
                <span>All recorded attendance will be permanently saved and this session locked.</span>
              </div>
              <Button
                size="lg"
                variant="primary"
                className="font-bold shrink-0 gap-1.5"
                leftIcon={<Send className="w-4 h-4" />}
                onClick={() => setIsConfirmModalOpen(true)}
                disabled={isHoliday || roster.length === 0 || !sessionId || sessionLoading}
              >
                Submit Verified Attendance
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Modal */}
      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        title="Confirm Attendance Submission"
        description="Please review the roll call summary before committing official academic records."
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Course / Subject:</span>
              <span className="font-bold text-slate-900">{selectedSub?.code} — {selectedSub?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Section(s):</span>
              <span className="font-semibold text-slate-800">
                Section {sectionLabelList} {isCombined ? '(Combined)' : ''}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Session Date & Room:</span>
              <span className="font-mono text-slate-800">{sessionDate} • {startTime}–{endTime} ({room})</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <span className="text-[10px] uppercase font-bold text-emerald-700">Present</span>
              <p className="text-lg font-bold text-emerald-800 mt-0.5">{stats.present}</p>
            </div>
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200">
              <span className="text-[10px] uppercase font-bold text-rose-700">Absent</span>
              <p className="text-lg font-bold text-rose-800 mt-0.5">{stats.absent}</p>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <span className="text-[10px] uppercase font-bold text-amber-700">Late</span>
              <p className="text-lg font-bold text-amber-800 mt-0.5">{stats.late}</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsConfirmModalOpen(false)}
            >
              Back to Editing
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
              onClick={handleSubmitManual}
            >
              Commit & Submit
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};