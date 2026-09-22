import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { timesheetService } from '../../services/timesheetService';
import { semesterService } from '../../services/semesterService';
import { sectionService } from '../../services/sectionService';
import { subjectService } from '../../services/subjectService';
import { teacherService } from '../../services/teacherService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Semester, Section, Subject, Teacher } from '../../types';
import { ApiTimesheetEntry, ApiTimesheetFilters, ApiTimesheetSummary } from '../../types/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { StatCard } from '../../components/ui/StatCard';
import { TimesheetEntryModal } from './TimesheetEntryModal';
import { RejectEntryModal } from './RejectEntryModal';
import {
  formatDuration,
  formatTime,
  sectionsLabel,
  statusBadgeVariant,
  TIMESHEET_STATUS_LABELS,
  TIMESHEET_TYPE_LABELS,
  typeLabel,
} from './timesheetPresentation';
import {
  ClipboardList,
  Plus,
  Send,
  Undo2,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  Download,
  CalendarDays,
  Clock,
  BookOpen,
  Hourglass,
} from 'lucide-react';

/**
 * Teacher timesheet — role-aware single surface.
 *
 * Teachers manage their own entries (create → submit → recall) and admins
 * additionally confirm/reject, filter across faculty, and export the approved
 * ledger as .xlsx. Every rule (status transitions, overlaps, identity scoping,
 * CONFIRMED-only summary/export) is enforced by the backend; this view only
 * drives those actions.
 */
export const TimesheetView: React.FC = () => {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const { showToast } = useToast();

  const [entries, setEntries] = useState<ApiTimesheetEntry[]>([]);
  const [summary, setSummary] = useState<ApiTimesheetSummary | null>(null);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  // Server-side filters.
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [semesterFilter, setSemesterFilter] = useState('all');
  const [teacherFilter, setTeacherFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Entry modal (create/edit).
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ApiTimesheetEntry | null>(null);

  // Reject modal.
  const [entryToReject, setEntryToReject] = useState<ApiTimesheetEntry | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // Delete confirmation.
  const [entryToDelete, setEntryToDelete] = useState<ApiTimesheetEntry | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filters = useMemo<ApiTimesheetFilters>(
    () => ({
      type: typeFilter !== 'all' ? typeFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      semester: semesterFilter !== 'all' ? semesterFilter : undefined,
      teacher: teacherFilter !== 'all' ? teacherFilter : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [typeFilter, statusFilter, semesterFilter, teacherFilter, dateFrom, dateTo],
  );

  const loadOptions = useCallback(async () => {
    try {
      const [sem, subj, sec, tch] = await Promise.all([
        semesterService.getSemesters(),
        subjectService.getSubjects(),
        sectionService.getSections(),
        isAdmin ? teacherService.getTeachers() : Promise.resolve([]),
      ]);
      setSemesters(sem);
      setSubjects(subj);
      setSections(sec);
      setTeachers(tch);
    } catch (err) {
      showToast({
        title: 'Could not load options',
        description: (err as Error).message,
        type: 'danger',
      });
    }
  }, [isAdmin, showToast]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        timesheetService.listEntries(filters),
        timesheetService.getSummary(filters),
      ]);
      setEntries(
        list.sort(
          (a, b) =>
            a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : 0 ||
            (a.start_time < b.start_time ? 1 : -1),
        ),
      );
      setSummary(sum);
    } catch (err) {
      showToast({
        title: 'Could not load timesheet',
        description: (err as Error).message,
        type: 'danger',
      });
      setEntries([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ---- Actions -----------------------------------------------------------

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (entry: ApiTimesheetEntry) => {
    setEditing(entry);
    setModalOpen(true);
  };

  const handleSaved = async (saved: ApiTimesheetEntry) => {
    setModalOpen(false);
    setEditing(null);
    showToast({
      title: 'Entry Saved',
      description: `${saved.entry_date} · ${typeLabel(saved.type)} · ${formatDuration(saved.duration_minutes)}`,
      type: 'success',
    });
    await reload();
  };

  const runAction = async (
    entry: ApiTimesheetEntry,
    call: (id: number) => Promise<ApiTimesheetEntry>,
    title: string,
  ) => {
    try {
      await call(entry.id);
      showToast({ title, description: `Entry #${entry.id} (${entry.entry_date}).`, type: 'success' });
      await reload();
    } catch (err) {
      showToast({ title: 'Action failed', description: (err as Error).message, type: 'danger' });
    }
  };

  const handleReject = async (reason: string) => {
    if (!entryToReject) return;
    setRejecting(true);
    try {
      await timesheetService.rejectEntry(entryToReject.id, reason);
      showToast({
        title: 'Entry Rejected',
        description: `Entry #${entryToReject.id} returned with feedback.`,
        type: 'warning',
      });
      setRejectOpen(false);
      setEntryToReject(null);
      await reload();
    } catch (err) {
      showToast({ title: 'Could not reject entry', description: (err as Error).message, type: 'danger' });
    } finally {
      setRejecting(false);
    }
  };

  const confirmDelete = async () => {
    if (!entryToDelete) return;
    setDeleting(true);
    try {
      await timesheetService.deleteEntry(entryToDelete.id);
      showToast({ title: 'Entry Deleted', description: 'The timesheet entry was removed.', type: 'success' });
      setDeleteOpen(false);
      setEntryToDelete(null);
      await reload();
    } catch (err) {
      showToast({ title: 'Could not delete entry', description: (err as Error).message, type: 'danger' });
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const filename = await timesheetService.exportEntries(filters);
      showToast({ title: 'Export ready', description: `${filename} has been downloaded.`, type: 'success' });
    } catch (err) {
      showToast({ title: 'Export failed', description: (err as Error).message, type: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  // ---- Per-status capability ---------------------------------------------

  const canEdit = (e: ApiTimesheetEntry) =>
    isAdmin ? e.status !== 'confirmed' : e.status === 'draft' || e.status === 'rejected';
  const canDelete = (e: ApiTimesheetEntry) =>
    isAdmin ? e.status !== 'confirmed' : e.status === 'draft' || e.status === 'rejected';
  const canSubmit = (e: ApiTimesheetEntry) => e.status === 'draft' || e.status === 'rejected';
  const canRecall = (e: ApiTimesheetEntry) => e.status === 'submitted';
  const canConfirm = (e: ApiTimesheetEntry) => isAdmin && e.status === 'submitted';
  const canReject = (e: ApiTimesheetEntry) => isAdmin && e.status === 'submitted';

  const totalNonClass =
    (summary?.by_type.duty ?? 0) + (summary?.by_type.other ?? 0);

  const filterSelectClass =
    'bg-white text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {isAdmin ? 'Teacher Timesheet' : 'My Timesheet'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAdmin
              ? 'Approval ledger of teacher work hours — confirm entries, reject with feedback, export the approved hours.'
              : 'Log your daily class, duty, and other work hours — submit for admin approval.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={handleExport}
              isLoading={exporting}
            >
              Export .xlsx
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={openCreate}
          >
            Log Hours
          </Button>
        </div>
      </div>

      {/* Summary ledger (CONFIRMED only) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Confirmed Entries"
          value={summary?.count ?? 0}
          icon={<ClipboardList className="w-4 h-4" />}
          subtitle={isAdmin ? 'Approved rows in the ledger' : 'Your approved entries'}
        />
        <StatCard
          title="Total Hours"
          value={formatDuration(summary?.duration_minutes ?? 0)}
          icon={<Clock className="w-4 h-4" />}
          subtitle="Server-computed durations"
        />
        <StatCard
          title="Class Hours"
          value={formatDuration(summary?.by_type.class ?? 0)}
          icon={<BookOpen className="w-4 h-4" />}
        />
        <StatCard
          title="Duty + Other"
          value={formatDuration(totalNonClass)}
          icon={<Hourglass className="w-4 h-4" />}
        />
      </div>

      {/* Filter bar (server-side) */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center gap-3">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={filterSelectClass}>
          <option value="all">All Types</option>
          {Object.entries(TIMESHEET_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={filterSelectClass}>
          <option value="all">All Statuses</option>
          {Object.entries(TIMESHEET_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select value={semesterFilter} onChange={e => setSemesterFilter(e.target.value)} className={filterSelectClass}>
          <option value="all">All Semesters</option>
          {semesters.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {isAdmin && (
          <select value={teacherFilter} onChange={e => setTeacherFilter(e.target.value)} className={filterSelectClass}>
            <option value="all">All Faculty</option>
            {teachers.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}

        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className={filterSelectClass}
          aria-label="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className={filterSelectClass}
          aria-label="To date"
        />

        {isAdmin && teacherFilter === 'all' && summary && summary.per_teacher.length > 0 && (
          <span className="ml-auto text-[11px] text-slate-400">
            {summary.per_teacher.length} faculty with approved hours
          </span>
        )}
      </div>

      {/* Per-teacher breakdown (admin, unfiltered) */}
      {isAdmin && teacherFilter === 'all' && summary && summary.per_teacher.length > 0 && (
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-sm">Hours by Faculty</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="flex flex-wrap gap-2">
              {summary.per_teacher.map(row => (
                <span
                  key={row.teacher}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                >
                  <span className="font-semibold text-slate-800">{row.teacher_name}</span>
                  <span className="text-slate-400">{row.count} entries</span>
                  <span className="font-mono text-indigo-600 font-semibold">{formatDuration(row.duration_minutes)}</span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entries table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3">Date & Time</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Subject / Sections</th>
                  {isAdmin && <th className="px-5 py-3">Faculty</th>}
                  <th className="px-5 py-3">Duration</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 6} className="p-8 text-center text-slate-400">
                      Loading timesheet entries...
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 7 : 6} className="p-8">
                      <EmptyState
                        icon={<ClipboardList className="w-6 h-6" />}
                        title="No timesheet entries found"
                        description={
                          isAdmin
                            ? 'Entries logged by faculty will appear here for approval. Adjust the filters or log hours.'
                            : 'Log today’s class, duty, or other work hours to start building your timesheet.'
                        }
                        action={{ label: 'Log Hours', onClick: openCreate, icon: <Plus className="w-4 h-4" /> }}
                      />
                    </td>
                  </tr>
                ) : (
                  entries.map(entry => (
                    <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-900 whitespace-nowrap">
                          {entry.entry_date}
                          <span className="text-slate-400 font-normal ml-2 font-mono text-[11px]">
                            {formatTime(entry.start_time)}–{formatTime(entry.end_time)}
                          </span>
                        </div>
                        {(entry.is_holiday || entry.holiday_title) && (
                          <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                            <CalendarDays className="w-3 h-3" />
                            {entry.holiday_title || 'Holiday'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge variant={entry.type === 'class' ? 'purple' : entry.type === 'duty' ? 'info' : 'outline'}>
                          {typeLabel(entry.type)}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        {entry.type === 'class' ? (
                          <div>
                            <div className="font-bold text-slate-900">{entry.subject_name}</div>
                            <div className="text-[11px] text-indigo-600 font-mono font-semibold">
                              {entry.subject_code}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {sectionsLabel(entry.section_names)}
                              {entry.semester_name ? ` · ${entry.semester_name}` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">{sectionsLabel(entry.section_names)}</span>
                        )}
                        {entry.note && (
                          <div className="text-[11px] text-slate-500 italic truncate max-w-56">{entry.note}</div>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="px-5 py-3.5 text-slate-700">{entry.teacher_name}</td>
                      )}
                      <td className="px-5 py-3.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {formatDuration(entry.duration_minutes)}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <Badge variant={statusBadgeVariant(entry.status)}>
                          {TIMESHEET_STATUS_LABELS[entry.status]}
                        </Badge>
                        {entry.status === 'rejected' && entry.rejection_reason && (
                          <p className="text-[10px] text-rose-600 mt-1 max-w-40 leading-snug">
                            {entry.rejection_reason}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          {canSubmit(entry) && (
                            <button
                              onClick={() => runAction(entry, timesheetService.submitEntry, 'Entry Submitted')}
                              className="px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded font-semibold inline-flex items-center gap-1"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Submit
                            </button>
                          )}
                          {canRecall(entry) && (
                            <button
                              onClick={() => runAction(entry, timesheetService.recallEntry, 'Entry Recalled')}
                              className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded font-semibold inline-flex items-center gap-1"
                              title="Return to draft for editing"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                              Recall
                            </button>
                          )}
                          {canConfirm(entry) && (
                            <button
                              onClick={() => runAction(entry, timesheetService.confirmEntry, 'Entry Confirmed')}
                              className="px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 rounded font-semibold inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Confirm
                            </button>
                          )}
                          {canReject(entry) && (
                            <button
                              onClick={() => {
                                setEntryToReject(entry);
                                setRejectOpen(true);
                              }}
                              className="px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 rounded font-semibold inline-flex items-center gap-1"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          )}
                          {canEdit(entry) && (
                            <button
                              onClick={() => openEdit(entry)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-md hover:bg-indigo-50"
                              title={isAdmin ? 'Edit entry' : 'Edit (resets to draft)'}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDelete(entry) && (
                            <button
                              onClick={() => {
                                setEntryToDelete(entry);
                                setDeleteOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                              title="Delete entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
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

      {/* Entry create/edit modal */}
      <TimesheetEntryModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        entry={editing}
        teachers={teachers}
        subjects={subjects}
        sections={sections}
        isAdmin={isAdmin}
        onSaved={handleSaved}
      />

      {/* Reject modal */}
      <RejectEntryModal
        isOpen={rejectOpen}
        entry={entryToReject}
        submitting={rejecting}
        onClose={() => {
          setRejectOpen(false);
          setEntryToReject(null);
        }}
        onReject={handleReject}
      />

      {/* Delete confirmation */}
      <ConfirmationDialog
        isOpen={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setEntryToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="Delete Timesheet Entry?"
        message={
          entryToDelete?.status === 'submitted'
            ? 'This entry is awaiting confirmation. Recall it first, then delete.'
            : 'Are you sure you want to permanently remove this timesheet entry?'
        }
        confirmText="Delete Entry"
        isLoading={deleting}
      />
    </div>
  );
};