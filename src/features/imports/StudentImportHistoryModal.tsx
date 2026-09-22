/**
 * Student import history modal (Phase B).
 *
 * Lists the importing admin's own student import sessions (pending/confirmed)
 * with the persisted plan + placement summary and, when confirmed, the
 * created/updated/unchanged totals recorded at confirm time.
 */
import React, { useState, useEffect } from 'react';
import type { ApiImportSession } from '../../types/api';
import { studentImportService } from './studentImportService';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CheckCircle, Clock, AlertTriangle, FileSpreadsheet, ChevronRight, Calendar } from 'lucide-react';

interface StudentImportHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StudentImportHistoryModal: React.FC<StudentImportHistoryModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [history, setHistory] = useState<ApiImportSession[]>([]);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      studentImportService.getHistory().then(setHistory).catch(() => setHistory([]));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  /** Backend summary for student sessions always carries plans + placement. */
  const plans = (session: ApiImportSession): { new: number; update: number; unchanged: number; duplicate: number; error: number } | null => {
    const p = (session.summary as { plans?: { new: number; update: number; unchanged: number; duplicate: number; error: number } }).plans;
    return p || null;
  };

  const confirmed = (session: ApiImportSession): { created: number; updated: number; unchanged: number } | null => {
    const c = (session.summary as { confirmed?: { created: number; updated: number; unchanged: number } }).confirmed;
    return c || null;
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Student Import History</h3>
              <p className="text-xs text-slate-400">Audit trail of spreadsheet imports staged on the backend</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50 space-y-4">
          {history.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">No student import sessions exist yet.</div>
          ) : (
            <div className="space-y-3">
              {history.map(session => {
                const sessionPlans = plans(session);
                const confirmTotals = confirmed(session);
                const isSelected = selectedUuid === session.uuid;
                const isConfirmed = session.status === 'confirmed';
                return (
                  <div
                    key={session.uuid}
                    onClick={() => setSelectedUuid(isSelected ? null : session.uuid)}
                    className={`bg-white rounded-xl border p-4 transition cursor-pointer hover:border-slate-300 ${
                      isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-sm' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 font-mono text-xs">
                          <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 text-sm">{session.file_name}</span>
                            <Badge variant={isConfirmed ? 'success' : 'warning'} className="text-[10px] py-0">
                              {session.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            ID: <span className="font-mono text-slate-600">{session.uuid.slice(0, 8)}…</span> •{' '}
                            <span className="font-medium text-slate-700">{session.total_rows} rows</span> •{' '}
                            {new Date(session.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <div className="text-right">
                          <p className="font-bold text-slate-900">
                            {sessionPlans ? `${sessionPlans.new} new • ${sessionPlans.update} updates` : `${session.total_rows} rows`}
                          </p>
                          {sessionPlans && sessionPlans.error > 0 && (
                            <p className="text-[11px] text-rose-600 font-semibold">{sessionPlans.error} errors</p>
                          )}
                        </div>
                        <ChevronRight
                          className={`w-4 h-4 text-slate-400 transition-transform ${isSelected ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </div>

                    {isSelected && (
                      <div className="mt-4 pt-4 border-t border-slate-100 text-xs bg-slate-50/70 p-3 rounded-lg animate-in fade-in space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                          <div>
                            <span className="text-slate-500 font-medium">Rows Evaluated:</span>
                            <p className="font-bold text-slate-800">{session.total_rows}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">New:</span>
                            <p className="font-bold text-indigo-700">{sessionPlans?.new ?? 0}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Updates:</span>
                            <p className="font-bold text-emerald-700">{sessionPlans?.update ?? 0}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Duplicates:</span>
                            <p className="font-bold text-amber-700">{sessionPlans?.duplicate ?? 0}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Errors:</span>
                            <p className="font-bold text-rose-700">{sessionPlans?.error ?? 0}</p>
                          </div>
                        </div>

                        {confirmTotals && (
                          <div className="grid grid-cols-3 gap-3 border-t border-slate-200 pt-3">
                            <div>
                              <span className="text-slate-500 font-medium">Created:</span>
                              <p className="font-bold text-emerald-700">{confirmTotals.created}</p>
                            </div>
                            <div>
                              <span className="text-slate-500 font-medium">Updated:</span>
                              <p className="font-bold text-emerald-700">{confirmTotals.updated}</p>
                            </div>
                            <div>
                              <span className="text-slate-500 font-medium">Unchanged (skipped):</span>
                              <p className="font-bold text-slate-700">{confirmTotals.unchanged}</p>
                            </div>
                          </div>
                        )}

                        {isConfirmed && session.confirmed_at && (
                          <div className="flex items-center gap-1.5 text-emerald-700">
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span className="font-medium">Confirmed {new Date(session.confirmed_at).toLocaleString()}</span>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
                          <div>
                            <span className="text-slate-500 font-medium">Placement changes:</span>
                            <p className="font-bold text-slate-800">
                              {(session.summary as { placement?: { changed?: number; unresolved?: number; blank?: number } }).placement?.changed ?? 0}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Unresolved placements:</span>
                            <p className="font-bold text-rose-700">
                              {(session.summary as { placement?: { unresolved?: number } }).placement?.unresolved ?? 0}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>
                            {session.sheet_count} sheet(s) • Sheet: {session.sheet_name || 'Sheet1'}
                          </span>
                        </div>

                        {(sessionPlans?.error ?? 0) > 0 && (
                          <div className="flex items-start gap-1.5 text-rose-700">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>
                              {sessionPlans!.error} row(s) had errors or in-file duplicates at staging time.
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white px-6 py-3 border-t border-slate-200 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};