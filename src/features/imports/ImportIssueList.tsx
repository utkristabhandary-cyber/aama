/**
 * Read-only issue list for the generic institutional import engine.
 *
 * Renders each server issue with its severity badge and message. Foundation
 * only — not wired to any navigation or workflow yet (Phase A).
 */
import React from 'react';
import type { ApiImportIssue } from '../../types/api';
import { ImportSeverityBadge } from './ImportSeverityBadge';

export interface ImportIssueListProps {
  issues: ApiImportIssue[];
  emptyText?: string;
}

export const ImportIssueList: React.FC<ImportIssueListProps> = ({
  issues,
  emptyText = 'No issues.',
}) => {
  if (!issues.length) {
    return <p className="text-sm text-slate-500">{emptyText}</p>;
  }
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {issues.map(issue => (
        <li key={`${issue.severity}-${issue.code}-${issue.message}`} className="flex items-start gap-2 px-3 py-2">
          <ImportSeverityBadge severity={issue.severity} className="mt-0.5" />
          <span className="text-sm text-slate-700">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
};