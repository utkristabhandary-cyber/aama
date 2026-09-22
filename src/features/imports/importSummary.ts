import type {
  ApiImportCounts,
  ApiImportRow,
  ApiImportSeverity,
  ApiImportSummary,
} from '../../types/api';
import { worstImportSeverity } from './importSeverity';

/**
 * Read-only helpers over the generic import preview plan.
 *
 * These group the SERVER's verdicts; no client-side re-validation happens here
 * (the backend remains the single source of truth).
 */

export interface ImportRowPartition {
  valid: ApiImportRow[];
  suspicious: ApiImportRow[];
  errors: ApiImportRow[];
}

/** Group planned rows by worst-case severity (errors first, then …). */
export function partitionImportRows(rows: ApiImportRow[]): ImportRowPartition {
  const groups: ImportRowPartition = { valid: [], suspicious: [], errors: [] };
  for (const row of rows) {
    switch (row.severity) {
      case 'error':
        groups.errors.push(row);
        break;
      case 'suspicious':
        groups.suspicious.push(row);
        break;
      default:
        groups.valid.push(row);
    }
  }
  return groups;
}

/** Per-severity row tallies built from the plan (independent of count drift). */
export function countRowsBySeverity(rows: ApiImportRow[]): Record<ApiImportSeverity, number> {
  const counts: Record<ApiImportSeverity, number> = {
    valid: 0,
    warning: 0,
    suspicious: 0,
    error: 0,
  };
  for (const row of rows) counts[row.severity] += 1;
  return counts;
}

/** True when the backend reports confirmation would be blocked (ERROR rows). */
export function isImportBlocked(summary: ApiImportSummary): boolean {
  return summary.block_confirmation === true;
}

/** Human-readable summary of counts, e.g. "2 errors · 1 suspicious · 4 valid". */
export function importCountsLabel(counts: ApiImportCounts): string {
  const pluralize = (value: number, label: string, plural: string) =>
    `${value} ${label}${value === 1 ? '' : plural}`;
  const parts: string[] = [];
  const push = (value: number, label: string, plural: string) => {
    if (value > 0) parts.push(pluralize(value, label, plural));
  };
  push(counts.error_rows, 'error', 's');
  push(counts.suspicious_rows, 'suspicious', ' rows');
  push(counts.warning_rows, 'warning', 's');
  push(counts.valid_rows, 'valid', ' rows');
  return parts.join(' · ') || 'No rows';
}

/** Compact invariant for the row's top-level derived view (used by tests/UI). */
export function rowIssueCodes(row: ApiImportRow): string[] {
  return row.issues.map(issue => issue.code);
}

export function rowWorstSeverity(row: ApiImportRow): ApiImportSeverity {
  return worstImportSeverity(row.issues || []);
}