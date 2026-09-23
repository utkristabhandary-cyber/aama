/**
 * 7-Stage Teacher Import Wizard (Phase C).
 *
 * Stage flow:
 *   1. Upload     — select the institutional .xlsx workbook
 *   2. System check — file/sheet/header detection and column mapping
 *   3. Data quality  — per-row parsing verdicts (status/unknown columns)
 *   4. DB cross-check — plan partition vs existing records (new/update/unchanged)
 *   5. Review      — full read-only per-row breakdown with field diffs
 *   6. Confirm     — all-or-nothing atomic teacher write
 *   7. Result      — created/updated/unchanged totals
 *
 * The server is the single source of truth; the client only sends the file
 * (stage 1) and the session uuid (stage 6). Nothing is written until confirm.
 * Only Teacher master records are touched — never User accounts, passwords,
 * or timetable/assignment rows.
 */
import React, { useState } from 'react';
import type {
  ApiTeacherImportConfirm,
  ApiTeacherImportPlan,
  ApiTeacherImportPreview,
  ApiTeacherImportRow,
} from '../../types/api';
import { teacherImportService } from './teacherImportService';
import { ImportTemplateCard } from './ImportTemplateCard';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { ImportSeverityBadge } from './ImportSeverityBadge';
import {
  TEACHER_PLAN_BADGE_VARIANT,
  TEACHER_PLAN_LABELS,
  countTeacherPlans,
  isTeacherImportBlocked,
  partitionTeacherRows,
  teacherAccountActionForRow,
  teacherAccountPlanSummary,
  teacherFieldChangeSummary,
  teacherRowDisplay,
} from './teacherImportPresentation';
import {
  Upload,
  ArrowRight,
  ArrowLeft,
  Check,
  AlertTriangle,
  ShieldCheck,
  Database,
  FileSpreadsheet,
  CheckCircle,
  GraduationCap,
  Filter,
} from 'lucide-react';

type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STAGES: { step: Stage; title: string }[] = [
  { step: 1, title: 'Upload' },
  { step: 2, title: 'System Check' },
  { step: 3, title: 'Data Quality' },
  { step: 4, title: 'DB Cross-check' },
  { step: 5, title: 'Review' },
  { step: 6, title: 'Confirm' },
  { step: 7, title: 'Result' },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024; // backend limit (5 MB)

type RowFilter = 'all' | ApiTeacherImportPlan;

const PLAN_FILTERS: { key: RowFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'update', label: 'Updates' },
  { key: 'unchanged', label: 'Unchanged' },
  { key: 'duplicate', label: 'Duplicates' },
  { key: 'error', label: 'Errors' },
];

interface TeacherImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

export const TeacherImportWizard: React.FC<TeacherImportWizardProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [stage, setStage] = useState<Stage>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [preview, setPreview] = useState<ApiTeacherImportPreview | null>(null);
  const [confirmResult, setConfirmResult] = useState<ApiTeacherImportConfirm | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const { showToast } = useToast();

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    if (!selectedFile) {
      showToast({
        title: 'No file selected',
        message: 'Please select an .xlsx spreadsheet file first.',
        type: 'error',
      });
      return;
    }
    if (selectedFile.size > MAX_FILE_BYTES) {
      showToast({
        title: 'File too large',
        message: 'The maximum allowed spreadsheet size is 5 MB.',
        type: 'error',
      });
      return;
    }
    setIsUploading(true);
    try {
      const result = await teacherImportService.preview(selectedFile);
      setPreview(result);
      setConfirmResult(null);
      setRowFilter('all');
      setStage(2);
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message || 'The backend rejected the file.';
      showToast({ title: 'Preview failed', message, type: 'error' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setIsConfirming(true);
    try {
      const result = await teacherImportService.confirm(preview.session_uuid);
      setConfirmResult(result);
      setStage(7);
      showToast({
        title: 'Teacher import complete',
        message: `Committed ${result.result.created} new, ${result.result.updated} updated teacher records${
          result.result.accounts_provisioned > 0 ? ` and provisioned ${result.result.accounts_provisioned} login account(s).` : '.'
        }`,
        type: 'success',
      });
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message || 'The import was rejected.';
      showToast({ title: 'Import rejected', message, type: 'error' });
    } finally {
      setIsConfirming(false);
    }
  };

  const summary = preview?.summary;
  const planCounts = preview ? countTeacherPlans(preview.rows) : null;
  const partitions = preview ? partitionTeacherRows(preview.rows) : null;
  const blocked = summary ? isTeacherImportBlocked(summary) : false;

  const visibleRows = (): ApiTeacherImportRow[] => {
    if (!preview) return [];
    if (rowFilter === 'all') return preview.rows;
    return preview.rows.filter(r => r.plan === rowFilter);
  };

  const planBadge = (plan: ApiTeacherImportPlan) => (
    <Badge variant={TEACHER_PLAN_BADGE_VARIANT[plan]}>{TEACHER_PLAN_LABELS[plan]}</Badge>
  );

  const filterTabs = partitions
    ? [
        { key: 'all' as RowFilter, label: 'All', count: preview!.rows.length },
        { key: 'new' as RowFilter, label: 'New', count: partitions.newRows.length },
        { key: 'update' as RowFilter, label: 'Updates', count: partitions.updateRows.length },
        { key: 'unchanged' as RowFilter, label: 'Unchanged', count: partitions.unchangedRows.length },
        { key: 'duplicate' as RowFilter, label: 'Duplicates', count: partitions.duplicateRows.length },
        { key: 'error' as RowFilter, label: 'Errors', count: partitions.errorRows.length },
      ]
    : [];

  const summaryCards = () => {
    if (!summary || !planCounts) return null;
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <p className="text-[11px] text-slate-500 uppercase font-semibold">New teachers</p>
          <p className="text-xl font-black text-indigo-700 mt-0.5">{planCounts.new}</p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <p className="text-[11px] text-slate-500 uppercase font-semibold">Updates</p>
          <p className="text-xl font-black text-emerald-700 mt-0.5">{planCounts.update}</p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <p className="text-[11px] text-slate-500 uppercase font-semibold">Unchanged</p>
          <p className="text-xl font-black text-slate-600 mt-0.5">{planCounts.unchanged}</p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <p className="text-[11px] text-slate-500 uppercase font-semibold">Duplicates</p>
          <p className="text-xl font-black text-amber-600 mt-0.5">{planCounts.duplicate}</p>
        </div>
        <div className="bg-rose-50 p-3 rounded-xl border border-rose-200">
          <p className="text-[11px] text-rose-500 uppercase font-semibold">Errors</p>
          <p className="text-xl font-black text-rose-700 mt-0.5">{planCounts.error}</p>
        </div>
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
          <p className="text-[11px] text-slate-500 uppercase font-semibold">Rows read</p>
          <p className="text-xl font-black text-slate-800 mt-0.5">{summary.counts.total_rows}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header + 7-step stepper */}
        <div className="bg-slate-900 text-white px-6 py-5 border-b border-slate-800">
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                <GraduationCap className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Teacher Import
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Import teachers from the institutional roster workbook.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isUploading || isConfirming}
              className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
            >
              ✕
            </button>
          </div>

          {/* Stepper */}
          <div className="grid grid-cols-7 gap-2 pt-2 border-t border-slate-800">
            {STAGES.map(({ step, title }) => {
              const isCurrent = stage === step;
              const isPassed = stage > step;
              return (
                <button
                  key={step}
                  type="button"
                  disabled={!isPassed && !isCurrent}
                  onClick={() => isPassed && setStage(step)}
                  className={`text-left group transition py-1 ${
                    !isPassed && !isCurrent ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  <div className="flex items-center space-x-1.5">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        isPassed
                          ? 'bg-emerald-500 text-white'
                          : isCurrent
                          ? 'bg-indigo-500 text-white ring-2 ring-indigo-400/50'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {isPassed ? <Check className="w-3 h-3" /> : step}
                    </div>
                    <span
                      className={`text-[10px] truncate hidden lg:inline font-medium ${
                        isCurrent ? 'text-indigo-300 font-semibold' : isPassed ? 'text-slate-200' : 'text-slate-400'
                      }`}
                    >
                      {title}
                    </span>
                  </div>
                  <div
                    className={`h-1 rounded-full mt-1.5 ${
                      isPassed ? 'bg-emerald-500' : isCurrent ? 'bg-indigo-400' : 'bg-slate-800'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
          {/* STAGE 1: UPLOAD */}
          {stage === 1 && (
            <div className="space-y-6">
              <div className="text-center max-w-xl mx-auto py-2">
                <h3 className="text-lg font-bold text-slate-900">Upload Teacher Roster</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Choose the teacher roster workbook. Check the column requirements below, then
                  select your .xlsx file.
                </p>
              </div>

              <ImportTemplateCard kind="teachers" />

              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center bg-white hover:border-indigo-500 transition cursor-pointer">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                  <Upload className="w-8 h-8" />
                </div>
                <h4 className="text-base font-semibold text-slate-900">Drag and drop your workbook here</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Only Microsoft Excel .xlsx workbooks (max 5 MB) are accepted.
                </p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setSelectedFile(file);
                          showToast({ title: 'File selected', message: file.name, type: 'info' });
                        }
                      }}
                    />
                    <span className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-xs font-semibold rounded-lg text-white bg-slate-900 hover:bg-slate-800 transition">
                      Browse Files
                    </span>
                  </label>
                </div>
              </div>

              {selectedFile && (
                <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between shadow-xs">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                      <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{selectedFile.name}</p>
                      <p className="text-xs text-slate-500">
                        Size: {(selectedFile.size / 1024).toFixed(1)} KB • Type: Excel Workbook
                      </p>
                    </div>
                  </div>
                  <Badge variant="success">Ready for Analysis</Badge>
                </div>
              )}

              <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-200 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div className="text-xs text-indigo-900 space-y-1">
                  <p className="font-semibold">Nothing is written until you confirm.</p>
                  <p>
                    This step builds a read-only plan. Rows are committed only at the Confirm
                    stage, all-or-nothing. This import never creates user accounts, passwords, or
                    timetable assignments.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 2: SYSTEM CHECK */}
          {stage === 2 && preview && summary && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
<div>
                <h3 className="text-lg font-bold text-slate-900">System Check</h3>
                <p className="text-xs text-slate-500">
                  File, worksheet and header/column detection — nothing has been written.
                </p>
              </div>
            </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase font-semibold">File</p>
                  <p className="text-sm font-semibold text-slate-800 truncate mt-1">{preview.file.name}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase font-semibold">Sheet</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{preview.file.sheet_name}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase font-semibold">Columns</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{summary.columns.total}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase font-semibold">Mapped</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">
                    {summary.columns.total - summary.columns.unmapped.length}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-white rounded-xl border border-slate-200">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Detected columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {summary.columns.identity.map(col => (
                    <span key={`identity-${col}`} className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-mono text-xs">
                      {col}
                    </span>
                  ))}
                  {summary.columns.identity.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-400 font-mono text-[10px]">identity</span>
                  )}
                  {summary.columns.unmapped.map(col => (
                    <span key={`unmapped-${col}`} className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-mono text-xs">
                      {col}
                    </span>
                  ))}
                  {summary.columns.unmapped.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-500 font-mono text-[10px]">unmapped</span>
                  )}
                </div>
              </div>

              {summary.alerts.length > 0 && (
                <div className="space-y-2">
                  {summary.alerts.map((alert, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-white border border-slate-200 flex items-start gap-2">
                      <ImportSeverityBadge severity={alert.severity} className="mt-0.5" />
                      <span className="text-sm text-slate-700">{alert.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STAGE 3: DATA QUALITY */}
          {stage === 3 && preview && summary && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Data Quality</h3>
                <p className="text-xs text-slate-500">
                  Per-row parsing verdicts (status aliases, unmapped columns, blank optional fields).
                </p>
              </div>
              {summaryCards()}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase font-semibold">Warnings</p>
                  <p className="text-xl font-black text-amber-600 mt-0.5">{summary.counts.warning_rows}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase font-semibold">Suspicious</p>
                  <p className="text-xl font-black text-blue-600 mt-0.5">{summary.counts.suspicious_rows}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase font-semibold">Empty skipped</p>
                  <p className="text-xl font-black text-slate-600 mt-0.5">{summary.counts.empty_rows}</p>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <p className="text-[11px] text-slate-500 uppercase font-semibold">Partial rows</p>
                  <p className="text-xl font-black text-slate-600 mt-0.5">{summary.counts.partial_rows}</p>
                </div>
              </div>
              <div className="p-4 bg-white rounded-xl border border-slate-200">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Field changes</p>
                <p className="text-sm text-slate-600">
                  {summary.changes.rows_with_changes} row(s) carry field updates
                  {summary.changes.change_fields.length
                    ? ` on: ${summary.changes.change_fields.map(f => f.replace(/_/g, ' ')).join(', ')}`
                    : ''}
                </p>
              </div>
            </div>
          )}

          {/* STAGE 4: DB CROSS-CHECK */}
          {stage === 4 && preview && summary && (
            <div className="space-y-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Database Cross-check</h3>
                <p className="text-xs text-slate-500">
                  Match result against existing teacher records (by Teacher ID; email is conflict-checked).
                </p>
              </div>
              {summaryCards()}

              <div className="p-4 bg-white rounded-xl border border-slate-200">
                <div className="flex items-center gap-2 mb-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Account provisioning (Phase D)
                  </p>
                </div>
                <p className="text-sm text-slate-600">{teacherAccountPlanSummary(summary.accounts)}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Login accounts are created only inside the all-or-nothing confirm. The initial password is a
                  generated credential that must be replaced at first login — it is never shown or stored in plaintext.
                </p>
              </div>

              {blocked && (
                <div className="p-4 bg-rose-50 rounded-xl border border-rose-200 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-rose-800 space-y-1">
                    <p className="font-semibold">Confirmation blocked</p>
                    <p>
                      {summary.plans.error} error row(s) and/or in-file duplicates would refuse the entire import. Review
                      stage 5 and fix the workbook, or remove the offending rows.
                    </p>
                  </div>
                </div>
              )}
              {!blocked && (
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-emerald-800">
                    <p className="font-semibold">Ready for confirmation</p>
                    <p>No blocking errors — the all-or-nothing confirm can proceed.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STAGE 5: REVIEW */}
          {stage === 5 && preview && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Admin Review</h3>
                  <p className="text-xs text-slate-500">
                    Read-only per-row breakdown. Filter by plan to focus on what matters.
                  </p>
                </div>
                <Badge variant="outline">Showing {visibleRows().length} of {preview.rows.length} rows</Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                {filterTabs.map(tab => (
                  <Button
                    key={tab.key}
                    variant={rowFilter === tab.key ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setRowFilter(tab.key)}
                  >
                    {tab.label} ({tab.count})
                  </Button>
                ))}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto max-h-[30rem]">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Teacher</th>
                        <th className="px-3 py-2">Department / Designation</th>
                        <th className="px-3 py-2">Plan</th>
                        <th className="px-3 py-2">Account</th>
                        <th className="px-3 py-2">Issues / Changes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleRows().map(row => {
                        const display = teacherRowDisplay(row);
                        const account = teacherAccountActionForRow(row.account);
                        const shownChanges = row.plan === 'update' ? row.field_changes : [];
                        return (
                          <tr key={row.row} className="hover:bg-slate-50 align-top">
                            <td className="px-3 py-2 font-mono font-bold text-slate-500">#{row.row}</td>
                            <td className="px-3 py-2">
                              <p className="font-semibold text-slate-900">{display.name || '—'}</p>
                              <p className="text-[11px] text-slate-500">{display.teacherId}</p>
                              <p className="text-[11px] text-slate-400">{display.email}</p>
                              {display.phone && <p className="text-[11px] text-slate-400">{display.phone}</p>}
                            </td>
                            <td className="px-3 py-2 text-slate-700">
                              <p>{display.department || '—'}</p>
                              <p className="text-[11px] text-slate-400">{display.designation || '—'}</p>
                              {display.qualification && (
                                <p className="text-[11px] text-slate-400">{display.qualification}</p>
                              )}
                              {display.status && (
                                <p className="text-[11px] text-slate-400">Status: {display.status}</p>
                              )}
                            </td>
                            <td className="px-3 py-2">{planBadge(row.plan)}</td>
                            <td className="px-3 py-2">
                              <Badge variant={account.variant}>{account.label}</Badge>
                              {account.username && (
                                <p className="text-[11px] font-mono text-slate-500 mt-1">{account.username}</p>
                              )}
                              {account.message && (
                                <p className="text-[11px] text-slate-500 mt-1 max-w-[16rem]">{account.message}</p>
                              )}
                            </td>
                            <td className="px-3 py-2 space-y-1">
                              {row.issues.length > 0 && (
                                <div className="max-w-xs">
                                  {row.issues.slice(0, 3).map((issue, idx) => (
                                    <p key={idx} className="flex items-start gap-1 mt-1 text-[11px] text-slate-600">
                                      <ImportSeverityBadge severity={issue.severity} />
                                      <span>{issue.message}</span>
                                    </p>
                                  ))}
                                  {row.issues.length > 3 && (
                                    <p className="text-[10px] text-slate-400 mt-1">+{row.issues.length - 3} more</p>
                                  )}
                                </div>
                              )}
                              {shownChanges.length > 0 && (
                                <div className="text-[11px] text-emerald-700 bg-emerald-50 rounded px-1.5 py-1 space-y-0.5">
                                  <p>
                                    <Filter className="w-3 h-3 inline mr-1" />
                                    {shownChanges.map((c, idx) => (
                                      <span key={c.field} className="block">
                                        <span className="font-semibold">{c.label}:</span>{' '}
                                        {c.old || '—'} → {c.new || '—'}
                                        {idx < shownChanges.length - 1 && ''}
                                      </span>
                                    ))}
                                  </p>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 6: CONFIRM */}
          {stage === 6 && preview && summary && (
            <div className="space-y-6">
              {blocked ? (
                <div className="max-w-xl mx-auto py-8 text-center space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 mx-auto flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Confirmation Blocked</h3>
                    <p className="text-xs text-slate-600 mt-1">
                      {summary.plans.error} error row(s) or in-file duplicates prevent an all-or-nothing import. The
                      confirm button is disabled until the workbook is corrected.
                    </p>
                  </div>
                  <Button variant="danger" disabled onClick={() => {}}>
                    Confirm & Commit to Database
                  </Button>
                </div>
              ) : (
                <div className="max-w-xl mx-auto py-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 mx-auto flex items-center justify-center">
                    <Database className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Ready to Ingest Teachers</h3>
                    <p className="text-xs text-slate-600 mt-1">
                      You are about to commit {planCounts?.new ?? 0} new teachers and {planCounts?.update ?? 0} updates.
                      {planCounts?.unchanged ? ` ${planCounts.unchanged} unchanged rows will be skipped.` : ''}
                      {summary.accounts.provision > 0
                        ? ` ${summary.accounts.provision} new login account${summary.accounts.provision === 1 ? '' : 's'} will be provisioned inside the same transaction.`
                        : ''}
                    </p>
                  </div>

                  <div className="p-4 bg-slate-900 text-slate-200 rounded-xl text-left text-xs space-y-2">
                    <div className="flex items-center space-x-2 text-emerald-400 font-semibold">
                      <ShieldCheck className="w-4 h-4" />
                      <span>All-or-nothing atomic write</span>
                    </div>
                    <p className="text-slate-400">
                      The server re-validates every stored row against the current database inside a single transaction.
                      If any row has an error or conflict the entire import is refused and nothing is written. Only
                      Teacher master records are touched.
                    </p>
                  </div>

                  {isConfirming && (
                    <div className="space-y-2 pt-4">
                      <p className="text-xs text-slate-500 font-mono">Committing teacher records…</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STAGE 7: RESULT */}
          {stage === 7 && confirmResult && (
            <div className="max-w-xl mx-auto py-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 mx-auto flex items-center justify-center">
                <CheckCircle className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Import Successfully Completed</h3>
              </div>

              <div className="grid grid-cols-4 gap-3 text-left">
                <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
                  <span className="text-[11px] text-emerald-700 font-medium">Created</span>
                  <p className="text-xl font-bold text-emerald-900">{confirmResult.result.created}</p>
                </div>
                <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
                  <span className="text-[11px] text-emerald-700 font-medium">Updated</span>
                  <p className="text-xl font-bold text-emerald-900">{confirmResult.result.updated}</p>
                </div>
                <div className="bg-slate-100 p-3 rounded-lg border border-slate-200">
                  <span className="text-[11px] text-slate-600 font-medium">Unchanged</span>
                  <p className="text-xl font-bold text-slate-800">{confirmResult.result.unchanged}</p>
                </div>
                <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200">
                  <span className="text-[11px] text-indigo-700 font-medium">Accounts Provisioned</span>
                  <p className="text-xl font-bold text-indigo-900">{confirmResult.result.accounts_provisioned ?? 0}</p>
                </div>
              </div>

              <Button variant="primary" className="mt-4" onClick={onImportComplete}>
                Close & View Teachers
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-white px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <Button
            variant="outline"
            disabled={isUploading || isConfirming || stage === 1 || confirmResult !== null}
            onClick={() => setStage(prev => (prev > 1 ? ((prev - 1) as Stage) : prev))}
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>

          <div className="flex items-center space-x-3">
            <Button variant="ghost" onClick={onClose} disabled={isUploading || isConfirming}>
              {confirmResult ? 'Close' : 'Cancel'}
            </Button>

            {stage === 1 && (
              <Button variant="primary" onClick={handleAnalyze} isLoading={isUploading}>
                Analyze Spreadsheet <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}

            {[2, 3, 4, 5].includes(stage) && (
              <Button variant="primary" onClick={() => setStage(prev => ((prev + 1) as Stage))}>
                {stage === 5 ? 'Review Plan & Continue' : 'Continue'} <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}

            {stage === 6 && !blocked && (
              <Button
                variant="success"
                onClick={handleConfirm}
                isLoading={isConfirming}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                Confirm & Commit to Database
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};