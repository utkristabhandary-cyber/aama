import React, { useState, useEffect, useMemo } from 'react';
import { attendanceService } from '../../services/attendanceService';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { subjectService } from '../../services/subjectService';
import { teacherService } from '../../services/teacherService';
import { Semester, Section, Subject, Teacher } from '../../types';
import { ApiAttendanceSession, ApiRollStudent } from '../../types/api';
import { useToast } from '../../context/ToastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ClipboardList, Plus, Eye, Trash2, Lock } from 'lucide-react';

function fmtTime(value: string | null): string {
  return value ? value.slice(0, 5) : '—';
}

function sectionLabel(s: ApiAttendanceSession): string {
  return s.section_names.length ? s.section_names.join(' + ') : String(s.sections.join(' + '));
}

export const AttendanceAdminView: React.FC<{ onConductAttendance?: () => void }> = ({
  onConductAttendance,
}) => {
  const [sessions, setSessions] = useState<ApiAttendanceSession[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters are passed to the backend (`GET /attendance/sessions/`).
  const [semesterFilter, setSemesterFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [teacherFilter, setTeacherFilter] = useState('all');

  // Detail Modal
  const [detailSession, setDetailSession] = useState<ApiAttendanceSession | null>(null);
  const [detailRoster, setDetailRoster] = useState<ApiRollStudent[] | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<ApiAttendanceSession | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  const loadFilters = async () => {
    const [sem, sec, sub, tch] = await Promise.all([
      semesterService.getSemesters(),
      sectionService.getSections(),
      subjectService.getSubjects(),
      teacherService.getTeachers(),
    ]);
    setSemesters(sem);
    setSections(sec);
    setSubjects(sub);
    setTeachers(tch);
  };

  const reloadSessions = async () => {
    setLoading(true);
    try {
      const list = await attendanceService.getSessions({
        semesterId: semesterFilter !== 'all' ? semesterFilter : undefined,
        sectionId: sectionFilter !== 'all' ? sectionFilter : undefined,
        subjectId: subjectFilter !== 'all' ? subjectFilter : undefined,
        teacherId: teacherFilter !== 'all' ? teacherFilter : undefined,
      });
      setSessions(
        list.sort((a, b) => (a.session_date < b.session_date ? 1 : -1))
      );
    } catch (err) {
      showToast({
        title: 'Could not load sessions',
        description: (err as Error).message,
        type: 'danger',
      });
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFilters();
  }, []);

  useEffect(() => {
    reloadSessions();
  }, [semesterFilter, sectionFilter, subjectFilter, teacherFilter]);

  const openDetail = async (session: ApiAttendanceSession) => {
    setDetailSession(session);
    setDetailRoster(null);
    try {
      const roll = await attendanceService.getRoll(session.id);
      setDetailRoster(roll.students);
    } catch (err) {
      setDetailRoster([]);
      showToast({
        title: 'Could not load roster',
        description: (err as Error).message,
        type: 'danger',
      });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!sessionToDelete) return;
    setIsSubmitting(true);
    try {
      await attendanceService.deleteAttendanceSession(sessionToDelete.id);
      showToast({ title: 'Session Removed', description: 'Attendance log deleted.', type: 'success' });
      setIsDeleteDialogOpen(false);
      setSessionToDelete(null);
      await reloadSessions();
    } catch (err) {
      showToast({ title: 'Error', description: (err as Error).message, type: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const sessionStats = useMemo(() => {
    return sessions.map(s => {
      const records = s.records;
      const total = records.length;
      const present = records.filter(r => r.status === 'present').length;
      const absent = records.filter(r => r.status === 'absent').length;
      const late = records.filter(r => r.status === 'late').length;
      return { total, present, absent, late };
    });
  }, [sessions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Attendance Logs & Sessions</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Audit history of submitted roll-call records and individual student status logs
          </p>
        </div>
        {onConductAttendance && (
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={onConductAttendance}
          >
            Conduct Attendance
          </Button>
        )}
      </div>

      {/* Filter Bar (server-side) */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3">
        <select
          value={semesterFilter}
          onChange={e => setSemesterFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Semesters</option>
          {semesters.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          value={sectionFilter}
          onChange={e => setSectionFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Sections</option>
          {sections.map(sec => (
            <option key={sec.id} value={sec.id}>{sec.name}</option>
          ))}
        </select>

        <select
          value={subjectFilter}
          onChange={e => setSubjectFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Subjects</option>
          {subjects.map(sub => (
            <option key={sub.id} value={sub.id}>{sub.code}: {sub.name}</option>
          ))}
        </select>

        <select
          value={teacherFilter}
          onChange={e => setTeacherFilter(e.target.value)}
          className="bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700"
        >
          <option value="all">All Faculty</option>
          {teachers.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Sessions Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Date & Time</th>
                  <th className="px-5 py-3">Subject / Course</th>
                  <th className="px-5 py-3">Section</th>
                  <th className="px-5 py-3">Faculty Instructor</th>
                  <th className="px-5 py-3">Attendance Rate</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      Loading attendance sessions...
                    </td>
                  </tr>
                ) : sessions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8">
                      <EmptyState
                        icon={<ClipboardList className="w-6 h-6" />}
                        title="No attendance sessions found"
                        description="Sessions recorded by teachers or admins will appear in this log."
                        action={onConductAttendance ? { label: 'Take Attendance', onClick: onConductAttendance } : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  sessions.map((sess, idx) => {
                    const s = sessionStats[idx];
                    const pct = s.total > 0 ? Math.round(((s.present + s.late) / s.total) * 100) : 0;

                    return (
                      <tr key={sess.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3.5 font-medium text-slate-900 whitespace-nowrap">
                          {sess.session_date}
                          <span className="text-slate-400 font-normal ml-2 font-mono text-[11px]">
                            {fmtTime(sess.start_time)}–{fmtTime(sess.planned_end_time)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="font-bold text-slate-900">{sess.subject_name}</div>
                          <div className="text-[11px] text-indigo-600 font-mono font-semibold">{sess.subject_code}</div>
                        </td>
                        <td className="px-5 py-3.5 font-medium text-slate-800">
                          {sectionLabel(sess)}
                        </td>
                        <td className="px-5 py-3.5 text-slate-700">
                          {sess.teacher_name}
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{pct}%</span>
                            <span className="text-[10px] text-slate-400">
                              ({s.present}/{s.total} marked)
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {sess.is_finalized ? (
                            <Badge variant="success">Submitted (Locked)</Badge>
                          ) : (
                            <Badge variant="warning">Draft</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openDetail(sess)}
                              className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded font-semibold flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              View Roster
                            </button>
                            <button
                              onClick={() => {
                                setSessionToDelete(sess);
                                setIsDeleteDialogOpen(true);
                              }}
                              disabled={sess.is_finalized}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={sess.is_finalized ? 'Submitted sessions are locked and cannot be deleted' : 'Delete Session'}
                            >
                              {sess.is_finalized ? <Lock className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
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

      {/* Session Detail Modal */}
      {detailSession && (
        <Modal
          isOpen={!!detailSession}
          onClose={() => setDetailSession(null)}
          title="Attendance Session Breakdown"
          description={`${detailSession.session_date} • ${fmtTime(detailSession.start_time)}–${fmtTime(detailSession.planned_end_time)}`}
          maxWidth="lg"
        >
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
              <div>
                <h5 className="font-bold text-slate-900">{detailSession.subject_code}: {detailSession.subject_name}</h5>
                <p className="text-slate-500 mt-0.5">
                  {sectionLabel(detailSession)} • Instructor: {detailSession.teacher_name}
                </p>
              </div>
              <Badge variant={detailSession.is_finalized ? 'success' : 'warning'}>
                {detailSession.is_finalized ? 'Submitted' : 'Draft'}
              </Badge>
            </div>

            {detailSession.late_reason && (
              <div className="p-3 rounded-lg bg-indigo-50/50 border border-indigo-100 text-xs text-indigo-900">
                <span className="font-bold block">Class Log / Topic:</span>
                <span>{detailSession.late_reason}</span>
              </div>
            )}

            {detailRoster === null ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                Loading roster...
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {detailRoster.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    No students found for this session.
                  </div>
                ) : (
                  detailRoster.map(stu => (
                    <div key={stu.studentId} className="p-2.5 flex items-center justify-between hover:bg-slate-50">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono font-bold text-slate-700 text-xs w-6">{stu.rollNo}</span>
                        <div>
                          <span className="font-semibold text-slate-900 text-xs">{stu.studentName}</span>
                          <span className="text-[11px] text-slate-400 block font-mono">{stu.studentCode}</span>
                        </div>
                      </div>
                      {stu.status ? (
                        <Badge
                          variant={
                            stu.status === 'present' ? 'success' : stu.status === 'absent' ? 'danger' : 'warning'
                          }
                        >
                          {stu.status.toUpperCase()}
                        </Badge>
                      ) : (
                        <Badge variant="default">UNMARKED</Badge>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={() => setDetailSession(null)}>
                Close Breakdown
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Attendance Session?"
        message={
          sessionToDelete?.is_finalized
            ? 'This session has already been submitted and is locked. It cannot be deleted.'
            : 'Are you sure you want to permanently remove this attendance session record? Student percentages will recalculate automatically.'
        }
        confirmText="Delete Session"
        isLoading={isSubmitting}
      />
    </div>
  );
};