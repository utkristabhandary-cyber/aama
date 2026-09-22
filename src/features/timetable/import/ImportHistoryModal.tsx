import React, { useState, useEffect } from 'react';
import { ApiTimetableImportSession } from '../../../types/api';
import { timetableLiveApi } from '../../../services/timetableLiveApi';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import {
  FileSpreadsheet,
  Clock,
  CheckCircle,
  AlertTriangle,
  Users,
  ChevronRight,
  Calendar,
} from 'lucide-react';

interface ImportHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImportHistoryModal: React.FC<ImportHistoryModalProps> = ({ isOpen, onClose }) => {
  const [history, setHistory] = useState<ApiTimetableImportSession[]>([]);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      timetableLiveApi.getImportHistory().then(setHistory);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const unresolvedCount = (session: ApiTimetableImportSession): number => {
    const u = session.summary?.unresolved;
    if (!u) return 0;
    return u.semesters.length + u.sections.length + u.subjects.length + u.teachers.length;
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Timetable Import History</h3>
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
            <div className="text-center py-12 text-slate-500 text-sm">
              No timetable import sessions exist yet.
            </div>
          ) : (
            <div className="space-y-3">
              {history.map(session => {
                const counts = session.summary?.counts;
                const isSelected = selectedUuid === session.uuid;
                const isConfirmed = session.status === 'confirmed';
                return (
                  <div
                    key={session.uuid}
                    onClick={() => setSelectedUuid(isSelected ? null : session.uuid)}
                    className={`bg-white rounded-xl border p-4 transition cursor-pointer hover:border-slate-300 ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-sm' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 font-mono text-xs">
                          <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
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
                            <span className="font-medium text-slate-700">{session.file_size} KB</span> •{' '}
                            <span className="font-medium text-slate-700">{session.sheet_name || 'Sheet'}</span> •{' '}
                            {new Date(session.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <div className="text-right">
                          <p className="font-bold text-slate-900">{session.total_rows} Rows</p>
                          <p className="text-[11px] text-purple-700 font-semibold">
                            {counts?.new_rows ?? 0} new • {counts?.updated_rows ?? 0} updates
                          </p>
                        </div>
                        <ChevronRight
                          className={`w-4 h-4 text-slate-400 transition-transform ${isSelected ? 'rotate-90' : ''}`}
                        />
                      </div>
                    </div>

                    {isSelected && (
                      <div className="mt-4 pt-4 border-t border-slate-100 text-xs bg-slate-50/70 p-3 rounded-lg animate-in fade-in space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <span className="text-slate-500 font-medium">Rows Evaluated:</span>
                            <p className="font-bold text-slate-800">{session.total_rows}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Created:</span>
                            <p className="font-bold text-emerald-700">
                              {counts?.created_rows ?? counts?.new_rows ?? 0}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Updated:</span>
                            <p className="font-bold text-emerald-700">{counts?.updated_rows ?? 0}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Errors:</span>
                            <p className="font-bold text-rose-700">{counts?.error_rows ?? 0}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Duplicates (skipped):</span>
                            <p className="font-bold text-slate-700">{counts?.duplicate_rows ?? 0}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Unchanged (skipped):</span>
                            <p className="font-bold text-slate-700">{counts?.unchanged_rows ?? 0}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Combined Groups:</span>
                            <p className="font-bold text-purple-700">{counts?.combined_rows ?? 0}</p>
                          </div>
                          <div>
                            <span className="text-slate-500 font-medium">Conflicts:</span>
                            <p className="font-bold text-amber-700">{counts?.conflict_rows ?? 0}</p>
                          </div>
                        </div>

                        {isConfirmed && session.confirmed_at && (
                          <div className="flex items-center gap-1.5 text-emerald-700">
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span className="font-medium">
                              Confirmed {new Date(session.confirmed_at).toLocaleString()}
                            </span>
                          </div>
                        )}

                        {unresolvedCount(session) > 0 && (
                          <div className="flex items-start gap-1.5 text-amber-700">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>
                              Unresolved values present —{' '}
                              {session.summary.unresolved.semesters.length} semester(s),{' '}
                              {session.summary.unresolved.sections.length} section(s),{' '}
                              {session.summary.unresolved.subjects.length} subject(s),{' '}
                              {session.summary.unresolved.teachers.length} teacher(s)
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 text-slate-500">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>
                            {session.sheet_count} sheet(s) • Sheet: {session.sheet_name || 'Sheet1'}
                          </span>
                          {counts?.combined_rows != null && counts.combined_rows > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Users className="w-3.5 h-3.5" /> {counts.combined_rows} combined teaching session(s)
                            </span>
                          )}
                        </div>
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