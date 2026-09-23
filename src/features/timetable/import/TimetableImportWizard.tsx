import React, { useState } from 'react';
import { ApiTimetableImportConfirm, ApiTimetableImportPreview } from '../../../types/api';
import { timetableLiveApi } from '../../../services/timetableLiveApi';
import { useToast } from '../../../context/ToastContext';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { ImportTemplateCard } from '../../imports/ImportTemplateCard';
import {
  detectRawColumns,
  partitionImportRows,
  TimetableImportRowView,
  toImportRowView,
} from './importRowPresentation';
import {
  Upload,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  XCircle,
  FileSpreadsheet,
  Check,
  ShieldCheck,
  Database,
  Clock,
  MapPin,
  BookOpen,
} from 'lucide-react';

interface TimetableImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

type WizardStep = 1 | 2 | 3;

const STEP_TITLES = ['Upload Spreadsheet', 'Review Changes', 'Confirm Import'];

const MAX_FILE_BYTES = 5 * 1024 * 1024; // backend limit (5 MB)

type RowFilter = 'all' | 'error' | 'warning' | 'new' | 'update' | 'duplicate' | 'unchanged';

export const TimetableImportWizard: React.FC<TimetableImportWizardProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [preview, setPreview] = useState<ApiTimetableImportPreview | null>(null);
  const [confirmResult, setConfirmResult] = useState<ApiTimetableImportConfirm | null>(null);
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const { showToast } = useToast();

  if (!isOpen) return null;

  // STEP 1 -> 2: Upload and Preview (server produces the whole plan)
  const handleAnalyze = async () => {
    if (!selectedFile) {
      showToast({ title: 'No File Selected', message: 'Please select an .xlsx spreadsheet file first.', type: 'error' });
      return;
    }
    if (selectedFile.size > MAX_FILE_BYTES) {
      showToast({
        title: 'File Too Large',
        message: 'The maximum allowed spreadsheet size is 5 MB.',
        type: 'error',
      });
      return;
    }
    setIsUploading(true);
    try {
      const result = await timetableLiveApi.previewImport(selectedFile);
      setPreview(result);
      setConfirmResult(null);
      setRowFilter('all');
      setCurrentStep(2);
    } catch (err: any) {
      showToast({
        title: 'Preview Failed',
        message: err?.message || 'Could not preview the spreadsheet. The backend rejected the file.',
        type: 'error',
      });
    } finally {
      setIsUploading(false);
    }
  };

  // STEP 3: Confirm and commit transitively on the server
  const handleConfirm = async () => {
    if (!preview) return;
    setIsConfirming(true);
    try {
      const result = await timetableLiveApi.confirmImport(preview.session_uuid);
      setConfirmResult(result);
      showToast({
        title: 'Import Successful',
        message: `Committed ${result.summary.counts.created_rows ?? 0} new and ${result.summary.counts.updated_rows ?? 0} updated timetable sessions.`,
        type: 'success',
      });
    } catch (err: any) {
      showToast({
        title: 'Import Failed — Rolled Back',
        message: err?.message || 'The import could not be committed and was rolled back.',
        type: 'error',
      });
    } finally {
      setIsConfirming(false);
    }
  };

  const counts = preview?.summary.counts;
  const allRowViews = preview ? preview.rows.map(toImportRowView) : [];
  const partitions = preview ? partitionImportRows(preview.rows) : null;

  const visibleRows = (): TimetableImportRowView[] => {
    if (!partitions) return [];
    if (rowFilter === 'error') return partitions.errors;
    if (rowFilter === 'warning') return partitions.warnings;
    if (rowFilter === 'new') return partitions.newRows;
    if (rowFilter === 'update') return partitions.updateRows;
    if (rowFilter === 'duplicate') return partitions.duplicateRows;
    if (rowFilter === 'unchanged') return partitions.unchangedRows;
    return allRowViews;
  };

  const statusBadge = (row: TimetableImportRowView) => {
    if (row.status === 'error') return <Badge variant="error">Error</Badge>;
    if (row.status === 'warning') return <Badge variant="warning">Warning</Badge>;
    if (row.status === 'update') return <Badge variant="success">Update</Badge>;
    if (row.status === 'duplicate') return <Badge variant="warning">Duplicate</Badge>;
    if (row.status === 'unchanged') return <Badge variant="outline">Unchanged</Badge>;
    return <Badge variant="success">Valid</Badge>;
  };

  const planBadge = (row: TimetableImportRowView) => {
    switch (row.plan) {
      case 'new':
        return <Badge variant="info">New</Badge>;
      case 'update':
        return <Badge variant="success">Update</Badge>;
      case 'duplicate':
        return <Badge variant="warning">Duplicate</Badge>;
      case 'unchanged':
        return <Badge variant="outline">Unchanged</Badge>;
      default:
        return <Badge variant="error">Error</Badge>;
    }
  };

  const sectionLabel = (row: TimetableImportRowView) => {
    const base = row.sectionRaw;
    const expanded = row.sectionsExpanded.length > 0 ? row.sectionsExpanded.join(', ') : '';
    return expanded && expanded !== row.sectionRaw ? `${base} → ${expanded}` : base;
  };

  const filterTabs: { key: RowFilter; label: string; count: number }[] = partitions
    ? [
        { key: 'all', label: 'All', count: preview!.rows.length },
        { key: 'error', label: 'Errors', count: partitions.errors.length },
        { key: 'warning', label: 'Warnings', count: partitions.warnings.length },
        { key: 'new', label: 'New', count: partitions.newRows.length },
        { key: 'update', label: 'Updates', count: partitions.updateRows.length },
        { key: 'duplicate', label: 'Duplicates', count: partitions.duplicateRows.length },
        { key: 'unchanged', label: 'Unchanged', count: partitions.unchangedRows.length },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header & Stepper */}
        <div className="bg-slate-900 text-white px-6 py-5 border-b border-slate-800">
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400 font-bold">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Timetable Import
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Import class schedules from a timetable workbook.
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
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800">
            {STEP_TITLES.map((title, idx) => {
              const stepNum = (idx + 1) as WizardStep;
              const isCurrent = currentStep === stepNum;
              const isPassed = currentStep > stepNum;
              return (
                <button
                  key={title}
                  type="button"
                  disabled={!isPassed && !isCurrent}
                  onClick={() => isPassed && setCurrentStep(stepNum)}
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
                          ? 'bg-amber-500 text-slate-950 ring-2 ring-amber-400/50'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {isPassed ? <Check className="w-3 h-3" /> : stepNum}
                    </div>
                    <span
                      className={`text-[11px] truncate hidden md:inline font-medium ${
                        isCurrent ? 'text-amber-400 font-semibold' : isPassed ? 'text-slate-200' : 'text-slate-400'
                      }`}
                    >
                      {title}
                    </span>
                  </div>
                  <div
                    className={`h-1 rounded-full mt-1.5 ${
                      isPassed ? 'bg-emerald-500' : isCurrent ? 'bg-amber-400' : 'bg-slate-800'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Step Body */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
          {/* STEP 1: UPLOAD */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="text-center max-w-xl mx-auto py-2">
                <h3 className="text-lg font-bold text-slate-900">Upload Timetable Spreadsheet</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Choose the timetable workbook. Check the column requirements below, then
                  select your .xlsx file.
                </p>
              </div>

              <ImportTemplateCard kind="timetable" />

              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center bg-white hover:border-blue-500 transition cursor-pointer">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                  <Upload className="w-8 h-8" />
                </div>
                <h4 className="text-base font-semibold text-slate-900">Drag and drop your spreadsheet here</h4>
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
                          showToast({ title: 'File Selected', message: file.name, type: 'info' });
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
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
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

              <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 space-y-1">
                  <p className="font-semibold">Nothing is written until you confirm.</p>
                  <p>
                    This step builds a read-only plan. Rows are committed only when you confirm
                    the import, and identical existing rows are never duplicated.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: REVIEW PREVIEW */}
          {currentStep === 2 && preview && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Server Preview</h3>
                  <p className="text-xs text-slate-500">
                    File: <span className="font-semibold text-slate-700">{selectedFile?.name}</span> • Sheet:{' '}
                    <span className="font-semibold text-slate-700">{preview.file.sheet_name}</span> •{' '}
                    <span className="font-semibold text-slate-700">{preview.rows.length}</span> rows evaluated
                  </p>
                </div>
              </div>

              {/* Summary counts */}
              {counts && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <p className="text-[11px] text-slate-500 uppercase font-semibold">Valid</p>
                    <p className="text-xl font-black text-emerald-700 mt-0.5">{counts.valid_rows}</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <p className="text-[11px] text-slate-500 uppercase font-semibold">Warnings</p>
                    <p className="text-xl font-black text-amber-600 mt-0.5">{counts.warning_rows}</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <p className="text-[11px] text-slate-500 uppercase font-semibold">New</p>
                    <p className="text-xl font-black text-blue-600 mt-0.5">{counts.new_rows}</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <p className="text-[11px] text-slate-500 uppercase font-semibold">Updates</p>
                    <p className="text-xl font-black text-emerald-600 mt-0.5">{counts.updated_rows}</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <p className="text-[11px] text-slate-500 uppercase font-semibold">Duplicates</p>
                    <p className="text-xl font-black text-slate-700 mt-0.5">{counts.duplicate_rows}</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <p className="text-[11px] text-slate-500 uppercase font-semibold">Unchanged</p>
                    <p className="text-xl font-black text-slate-500 mt-0.5">{counts.unchanged_rows}</p>
                  </div>
                  <div className="bg-rose-50 p-3 rounded-xl border border-rose-200">
                    <p className="text-[11px] text-rose-500 uppercase font-semibold">Errors</p>
                    <p className="text-xl font-black text-rose-700 mt-0.5">{counts.error_rows}</p>
                  </div>
                </div>
              )}

              {/* Detected columns (server-extracted, read-only) */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium">Server-detected columns:</span>
                {detectRawColumns(preview.rows).map(col => (
                  <span key={col} className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono">
                    {col}
                  </span>
                ))}
              </div>

              {/* Filter tabs */}
              {filterTabs.length > 0 && (
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
              )}

              {/* Row table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Planned Timetable Rows
                  </span>
                  <span className="text-xs text-slate-500">Showing {visibleRows().length} rows</span>
                </div>
                <div className="overflow-x-auto max-h-[28rem]">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-700 font-semibold sticky top-0">
                      <tr>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Semester</th>
                        <th className="px-3 py-2">Subject / Module</th>
                        <th className="px-3 py-2">Instructor</th>
                        <th className="px-3 py-2">Section(s)</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Day & Time</th>
                        <th className="px-3 py-2">Room / Block</th>
                        <th className="px-3 py-2">Plan</th>
                        <th className="px-3 py-2">Status / Issues</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleRows().map(row => (
                        <tr key={row.rowNumber} className="hover:bg-slate-50 align-top">
                          <td className="px-3 py-2 font-mono font-bold text-slate-500">#{row.rowNumber}</td>
                          <td className="px-3 py-2 text-slate-700">{row.semester}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{row.subject}</td>
                          <td className="px-3 py-2 text-slate-700">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span>{row.lecturer}</span>
                              {row.teacherAamsId &&
                                (row.teacherMatch === 'id' ? (
                                  <Badge variant="purple" className="text-[10px] py-0 font-mono">
                                    ID {row.teacherAamsId}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] py-0">
                                    By name
                                  </Badge>
                                ))}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={row.isCombined ? 'text-purple-700 font-semibold' : 'text-slate-700'}>
                              {sectionLabel(row)}
                            </span>
                            {row.isCombined && (
                              <span className="ml-1.5">
                                <Badge variant="purple" className="text-[10px] py-0">Combined</Badge>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{row.classType}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                            {row.day}
                            {row.startTime && `, ${row.startTime}–${row.endTime}`}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {row.room}
                            {row.block && ` (${row.block})`}
                          </td>
                          <td className="px-3 py-2">{planBadge(row)}</td>
                          <td className="px-3 py-2 space-y-1">
                            {statusBadge(row)}
                            {row.issues.length > 0 && (
                              <div className="max-w-xs">
                                {row.issues.slice(0, 3).map((issue, idx) => (
                                  <p
                                    key={idx}
                                    className={`flex items-start gap-1 mt-1 ${
                                      issue.level === 'error' ? 'text-rose-700' : 'text-amber-700'
                                    }`}
                                  >
                                    {issue.level === 'error' ? (
                                      <XCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                    ) : (
                                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                    )}
                                    <span>{issue.message}</span>
                                  </p>
                                ))}
                                {row.issues.length > 3 && (
                                  <p className="text-[10px] text-slate-400 mt-1">
                                    +{row.issues.length - 3} more issue(s)
                                  </p>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {(counts?.error_rows ?? 0) > 0 ? (
                <div className="flex items-start gap-2 text-xs text-rose-700 p-3 bg-rose-50 border border-rose-200 rounded-lg">
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      This import has {(counts?.error_rows ?? 0)} blocking row(s) and cannot be confirmed.
                    </p>
                    <p className="mt-0.5 text-rose-600">
                      Confirmation is all-or-nothing: the server refuses to commit while any row has an error
                      (e.g. an unknown or ambiguous teacher ID). Fix the workbook and re-upload.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* STEP 3: CONFIRM */}
          {currentStep === 3 && preview && (
            <div className="space-y-6">
              {!confirmResult ? (
                <div className="max-w-xl mx-auto py-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-600 mx-auto flex items-center justify-center">
                    <Database className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Ready to Ingest Timetable</h3>
                    <p className="text-xs text-slate-600 mt-1">
                      You are about to commit {counts?.commit_rows ?? 0} sessions ({counts?.new_rows ?? 0} new,{' '}
                      {counts?.updated_rows ?? 0} updates) and skip {counts?.duplicate_rows ?? 0} duplicates and{' '}
                      {counts?.unchanged_rows ?? 0} unchanged rows. Confirmation is all-or-nothing — if any row fails
                      re-validation, the entire import is refused and nothing is written.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-900 text-slate-200 rounded-xl text-left text-xs space-y-2">
                    <div className="flex items-center space-x-2 text-emerald-400 font-semibold">
                      <ShieldCheck className="w-4 h-4" />
                      <span>Transactional Rollback Protection</span>
                    </div>
                    <p className="text-slate-400">
                      The server re-validates every row — including each teacher ID — against the current database
                      before committing and wraps the import in a single atomic transaction. If any row fails (for
                      example a teacher ID that no longer resolves) or any write fails, the whole import is rolled
                      back, zero timetable records are written, and the pending session stays available for inspection.
                    </p>
                  </div>

                  {isConfirming && (
                    <div className="space-y-2 pt-4">
                      <p className="text-xs text-slate-500 font-mono">Committing records to the database…</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="max-w-xl mx-auto py-6 text-center space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 mx-auto flex items-center justify-center">
                    <CheckCircle className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">Import Successfully Completed</h3>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-left">
                    <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
                      <span className="text-[11px] text-emerald-700 font-medium">Created Sessions</span>
                      <p className="text-xl font-bold text-emerald-900">
                        {confirmResult.summary.counts.created_rows ?? 0}
                      </p>
                    </div>
                    <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
                      <span className="text-[11px] text-emerald-700 font-medium">Updated Sessions</span>
                      <p className="text-xl font-bold text-emerald-900">
                        {confirmResult.summary.counts.updated_rows ?? 0}
                      </p>
                    </div>
                    <div className="bg-slate-100 p-3 rounded-lg border border-slate-200">
                      <span className="text-[11px] text-slate-600 font-medium">Combined Groups</span>
                      <p className="text-xl font-bold text-slate-800">
                        {confirmResult.summary.counts.combined_rows ?? 0}
                      </p>
                    </div>
                  </div>

                  <Button variant="primary" className="mt-4" onClick={onImportComplete}>
                    Close & View Timetable
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="bg-white px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <Button
            variant="outline"
            disabled={isUploading || isConfirming || currentStep === 1 || confirmResult !== null}
            onClick={() => setCurrentStep(prev => (prev > 1 ? ((prev - 1) as WizardStep) : prev))}
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>

          <div className="flex items-center space-x-3">
            <Button variant="ghost" onClick={onClose} disabled={isUploading || isConfirming}>
              {confirmResult ? 'Close' : 'Cancel'}
            </Button>

            {currentStep === 1 && (
              <Button variant="primary" onClick={handleAnalyze} isLoading={isUploading}>
                Analyze Spreadsheet <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}

            {currentStep === 2 && (
              <Button
                variant="primary"
                disabled={(counts?.error_rows ?? 0) > 0}
                onClick={() => setCurrentStep(3)}
              >
                Review Plan & Continue <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}

            {currentStep === 3 && !confirmResult && (
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