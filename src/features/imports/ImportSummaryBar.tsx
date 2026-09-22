/**
 * Compact severity summary bar for the generic institutional import engine.
 *
 * Foundation only — not wired to any navigation or workflow yet (Phase A).
 */
import React from 'react';
import type { ApiImportSeverity, ApiImportSummary } from '../../types/api';
import { IMPORT_SEVERITY_LABEL } from './importSeverity';
import { importSeverityBadgeVariant } from './importSeverity';
import { isImportBlocked } from './importSummary';

const SEVERITY_CHIP_CLASS: Record<ApiImportSeverity, string> = {
  valid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  suspicious: 'bg-blue-50 text-blue-700 border-blue-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
};

const SEVERITY_COUNT_KEY = {
  valid: 'valid_rows',
  warning: 'warning_rows',
  suspicious: 'suspicious_rows',
  error: 'error_rows',
} as const;

export interface ImportSummaryBarProps {
  summary: ApiImportSummary;
}

export const ImportSummaryBar: React.FC<ImportSummaryBarProps> = ({ summary }) => {
  const { counts } = summary;
  const severities: ApiImportSeverity[] = ['valid', 'warning', 'suspicious', 'error'];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {severities.map(severity => (
        <span
          key={severity}
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${SEVERITY_CHIP_CLASS[severity]}`}
        >
          {counts[SEVERITY_COUNT_KEY[severity]]} {IMPORT_SEVERITY_LABEL[severity].toLowerCase()}
        </span>
      ))}
      {counts.empty_rows > 0 && (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          {counts.empty_rows} empty skipped
        </span>
      )}
      {isImportBlocked(summary) && (
        <span className="rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800">
          Confirmation blocked
        </span>
      )}
    </div>
  );
};