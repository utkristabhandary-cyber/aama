/**
 * Pure presentation helpers for the student import wizard (Phase B).
 *
 * All helpers are idempotent and side-effect-free: they read the server's
 * classification verdicts and produce display labels/badges for the React tree.
 */
import type {
  ApiAccountPlanCounts,
  ApiImportAccountAction,
  ApiImportIssue,
  ApiImportRowAccount,
  ApiImportSeverity,
  ApiStudentImportFieldChange,
  ApiStudentImportPlan,
  ApiStudentImportPlanCounts,
  ApiStudentImportPlacement,
  ApiStudentImportRow,
  ApiStudentImportSummary,
} from '../../types/api';

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

export const STUDENT_PLAN_LABELS: Record<ApiStudentImportPlan, string> = {
  new: 'New',
  update: 'Update',
  unchanged: 'Unchanged',
  duplicate: 'Duplicate',
  error: 'Error',
};

export const STUDENT_PLAN_BADGE_VARIANT: Record<ApiStudentImportPlan, 'info' | 'success' | 'outline' | 'warning' | 'danger'> = {
  new: 'info',
  update: 'success',
  unchanged: 'outline',
  duplicate: 'warning',
  error: 'danger',
};

// ---------------------------------------------------------------------------
// Row-level helpers
// ---------------------------------------------------------------------------

export function partitionStudentRows(rows: ApiStudentImportRow[]): {
  newRows: ApiStudentImportRow[];
  updateRows: ApiStudentImportRow[];
  unchangedRows: ApiStudentImportRow[];
  duplicateRows: ApiStudentImportRow[];
  errorRows: ApiStudentImportRow[];
} {
  const result = {
    newRows: [] as ApiStudentImportRow[],
    updateRows: [] as ApiStudentImportRow[],
    unchangedRows: [] as ApiStudentImportRow[],
    duplicateRows: [] as ApiStudentImportRow[],
    errorRows: [] as ApiStudentImportRow[],
  };
  for (const row of rows) {
    switch (row.plan) {
      case 'new':
        result.newRows.push(row);
        break;
      case 'update':
        result.updateRows.push(row);
        break;
      case 'unchanged':
        result.unchangedRows.push(row);
        break;
      case 'duplicate':
        result.duplicateRows.push(row);
        break;
      case 'error':
        result.errorRows.push(row);
        break;
    }
  }
  return result;
}

export function countStudentPlans(rows: ApiStudentImportRow[]): ApiStudentImportPlanCounts {
  const counts: ApiStudentImportPlanCounts = { new: 0, update: 0, unchanged: 0, duplicate: 0, error: 0 };
  for (const row of rows) counts[row.plan] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Blocking / gate
// ---------------------------------------------------------------------------

/** True when any row would block an all-or-nothing confirm. */
export function isStudentImportBlocked(summary: ApiStudentImportSummary): boolean {
  return summary.block_confirmation === true;
}

// ---------------------------------------------------------------------------
// Row display
// ---------------------------------------------------------------------------

export interface StudentRowDisplay {
  studentId: string;
  name: string;
  email: string;
  rollNo: string;
  semester: string;
  section: string;
  placementLabel: string;
}

/** Key values for the row table (read-only, never written). */
export function studentRowDisplay(row: ApiStudentImportRow): StudentRowDisplay {
  const v = row.values || {};
  const p = row.placement;
  const semName = p?.semester?.name || '—';
  const secName = p?.section || '—';
  const programPrefix = p?.program_token ? ` (${p.program_token})` : '';
  return {
    studentId: v.student_id || '',
    name: v.name || '',
    email: v.email || '',
    rollNo: v.roll_no || '',
    semester: semName,
    section: secName,
    placementLabel: `${secName}${programPrefix} / ${semName}`,
  };
}

// ---------------------------------------------------------------------------
// Field changes
// ---------------------------------------------------------------------------

export function fieldChangeSummary(changes: ApiStudentImportFieldChange[]): string {
  if (!changes.length) return 'No changes';
  return changes
    .map(c => {
      const oldVal = c.old || '—';
      const newVal = c.new || '—';
      return `${c.label}: ${oldVal} → ${newVal}`;
    })
    .join('; ');
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export function placementSummary(p: ApiStudentImportPlacement): string {
  if (!p) return 'No placement';
  if (p.placement_change) return 'Placement change';
  return `${p.section || '—'} / ${p.semester?.name || '—'}`;
}

// ---------------------------------------------------------------------------
// Severity / plan helpers
// ---------------------------------------------------------------------------

export function worstStudentRowSeverity(row: ApiStudentImportRow): ApiImportSeverity {
  let rank = 0;
  const order: ApiImportSeverity[] = ['valid', 'warning', 'suspicious', 'error'];
  const orderRank: Record<ApiImportSeverity, number> = { valid: 0, warning: 1, suspicious: 2, error: 3 };
  for (const issue of row.issues) {
    rank = Math.max(rank, orderRank[issue.severity] ?? 0);
  }
  for (const sev of order) {
    if (orderRank[sev] === rank) return sev;
  }
  return 'valid';
}

export function rowIssueCodes(row: ApiStudentImportRow): string[] {
  return (row.issues || []).map(i => i.code);
}

export function issueCountsBySeverity(issues: ApiImportIssue[]): Record<ApiImportSeverity, number> {
  const counts: Record<ApiImportSeverity, number> = { valid: 0, warning: 0, suspicious: 0, error: 0 };
  for (const issue of issues) {
    counts[issue.severity] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Phase D: account consequences (safe review labels; passwords never shown)
// ---------------------------------------------------------------------------

export type AccountBadgeVariant = 'info' | 'success' | 'outline' | 'warning' | 'danger';

export const STUDENT_ACCOUNT_LABELS: Record<ApiImportAccountAction, string> = {
  provision: 'Provision account',
  account_exists: 'Account exists',
  no_account: 'No account',
  account_conflict: 'ID conflict',
  error: 'Blocked',
};

export const STUDENT_ACCOUNT_BADGE_VARIANT: Record<ApiImportAccountAction, AccountBadgeVariant> = {
  provision: 'info',
  account_exists: 'success',
  no_account: 'outline',
  account_conflict: 'danger',
  error: 'danger',
};

export interface AccountRowDisplay {
  action: ApiImportAccountAction | null;
  label: string;
  variant: AccountBadgeVariant;
  username: string | null;
  mustChangePassword: boolean | null;
  message: string;
}

/** Read-only account consequence for one row (safe: no passwords on the client). */
export function accountActionForRow(account: ApiImportRowAccount | null | undefined): AccountRowDisplay {
  if (!account) {
    return {
      action: null,
      label: '—',
      variant: 'outline',
      username: null,
      mustChangePassword: null,
      message: '',
    };
  }
  return {
    action: account.action,
    label: STUDENT_ACCOUNT_LABELS[account.action] ?? account.action,
    variant: STUDENT_ACCOUNT_BADGE_VARIANT[account.action] ?? 'outline',
    username: account.username ?? null,
    mustChangePassword: account.must_change_password ?? null,
    message: account.message,
  };
}

/** Human summary of the rolled-up account plan counts. */
export function accountPlanSummary(accounts: ApiAccountPlanCounts | null | undefined): string {
  if (!accounts) return 'No account changes planned.';
  const bits: string[] = [];
  if (accounts.provision > 0) {
    bits.push(`${accounts.provision} new login${accounts.provision === 1 ? '' : 's'} will be created`);
  }
  if (accounts.account_exists > 0) {
    bits.push(`${accounts.account_exists} already exist`);
  }
  if (accounts.no_account > 0) {
    bits.push(`${accounts.no_account} no login`);
  }
  if (accounts.conflict > 0) {
    bits.push(`${accounts.conflict} conflict${accounts.conflict === 1 ? '' : 's'}`);
  }
  return bits.join(' • ') || 'No account changes planned.';
}
