import type { ApiImportIssue, ApiImportSeverity } from '../../types/api';

/**
 * Severity helpers for the generic institutional import engine.
 *
 * The engine's ordering is strict: VALID < WARNING < SUSPICIOUS < ERROR.
 * These helpers only MIRROR the server verdict; they never re-validate a row.
 */

export const IMPORT_SEVERITY_ORDER: ApiImportSeverity[] = [
  'valid',
  'warning',
  'suspicious',
  'error',
];

export const IMPORT_SEVERITY_RANK: Record<ApiImportSeverity, number> = {
  valid: 0,
  warning: 1,
  suspicious: 2,
  error: 3,
};

export const IMPORT_SEVERITY_LABEL: Record<ApiImportSeverity, string> = {
  valid: 'Valid',
  warning: 'Warning',
  suspicious: 'Suspicious',
  error: 'Error',
};

/** Map an engine severity to the shared UI Badge variant (non-generic UI safe). */
export function importSeverityBadgeVariant(
  severity: ApiImportSeverity,
): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  switch (severity) {
    case 'valid':
      return 'success';
    case 'warning':
      return 'warning';
    case 'suspicious':
      return 'info';
    case 'error':
      return 'danger';
    default:
      return 'default';
  }
}

/** Highest severity in a row/alerts list; `valid` when there are none. */
export function worstImportSeverity(issues: ApiImportIssue[]): ApiImportSeverity {
  let rank = 0;
  for (const item of issues) {
    rank = Math.max(rank, IMPORT_SEVERITY_RANK[item.severity] ?? 0);
  }
  for (const [level, value] of Object.entries(IMPORT_SEVERITY_RANK)) {
    if (value === rank) return level as ApiImportSeverity;
  }
  return 'valid';
}