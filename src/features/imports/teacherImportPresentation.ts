/**
 * Pure presentation helpers for the teacher import wizard (Phase C).
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
  ApiTeacherImportFieldChange,
  ApiTeacherImportPlan,
  ApiTeacherImportPlanCounts,
  ApiTeacherImportRow,
  ApiTeacherImportSummary,
} from '../../types/api';

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

export const TEACHER_PLAN_LABELS: Record<ApiTeacherImportPlan, string> = {
  new: 'New',
  update: 'Update',
  unchanged: 'Unchanged',
  duplicate: 'Duplicate',
  error: 'Error',
};

export const TEACHER_PLAN_BADGE_VARIANT: Record<
  ApiTeacherImportPlan,
  'info' | 'success' | 'outline' | 'warning' | 'danger'
> = {
  new: 'info',
  update: 'success',
  unchanged: 'outline',
  duplicate: 'warning',
  error: 'danger',
};

// ---------------------------------------------------------------------------
// Row-level helpers
// ---------------------------------------------------------------------------

export function partitionTeacherRows(rows: ApiTeacherImportRow[]): {
  newRows: ApiTeacherImportRow[];
  updateRows: ApiTeacherImportRow[];
  unchangedRows: ApiTeacherImportRow[];
  duplicateRows: ApiTeacherImportRow[];
  errorRows: ApiTeacherImportRow[];
} {
  const result = {
    newRows: [] as ApiTeacherImportRow[],
    updateRows: [] as ApiTeacherImportRow[],
    unchangedRows: [] as ApiTeacherImportRow[],
    duplicateRows: [] as ApiTeacherImportRow[],
    errorRows: [] as ApiTeacherImportRow[],
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

export function countTeacherPlans(rows: ApiTeacherImportRow[]): ApiTeacherImportPlanCounts {
  const counts: ApiTeacherImportPlanCounts = { new: 0, update: 0, unchanged: 0, duplicate: 0, error: 0 };
  for (const row of rows) counts[row.plan] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Blocking / gate
// ---------------------------------------------------------------------------

/** True when any row would block an all-or-nothing confirm. */
export function isTeacherImportBlocked(summary: ApiTeacherImportSummary): boolean {
  return summary.block_confirmation === true;
}

// ---------------------------------------------------------------------------
// Row display
// ---------------------------------------------------------------------------

export interface TeacherRowDisplay {
  teacherId: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  qualification: string;
  status: string;
}

/** Key values for the row table (read-only, never written). */
export function teacherRowDisplay(row: ApiTeacherImportRow): TeacherRowDisplay {
  const v = row.values || {};
  return {
    teacherId: v.teacher_id || '',
    name: v.name || '',
    email: v.email || '',
    phone: v.phone || '',
    department: v.department || '',
    designation: v.designation || '',
    qualification: v.qualification || '',
    status: v.status || '',
  };
}

// ---------------------------------------------------------------------------
// Field changes
// ---------------------------------------------------------------------------

export function teacherFieldChangeSummary(
  changes: ApiTeacherImportFieldChange[],
): string {
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
// Severity helpers
// ---------------------------------------------------------------------------

export function worstTeacherRowSeverity(row: ApiTeacherImportRow): ApiImportSeverity {
  let worst: ApiImportSeverity = 'valid';
  const orderRank: Record<ApiImportSeverity, number> = { valid: 0, warning: 1, suspicious: 2, error: 3 };
  for (const issue of row.issues) {
    const rank = orderRank[issue.severity] ?? 0;
    if (rank > orderRank[worst]) worst = issue.severity;
  }
  return worst;
}

export function teacherRowIssueCodes(row: ApiTeacherImportRow): string[] {
  return (row.issues || []).map(i => i.code);
}

export function teacherIssueCountsBySeverity(issues: ApiImportIssue[]): Record<ApiImportSeverity, number> {
  const counts: Record<ApiImportSeverity, number> = { valid: 0, warning: 0, suspicious: 0, error: 0 };
  for (const issue of issues) {
    counts[issue.severity] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Phase D: account consequences (safe review labels; passwords never shown)
// ---------------------------------------------------------------------------

export type TeacherAccountBadgeVariant = 'info' | 'success' | 'outline' | 'warning' | 'danger';

export const TEACHER_ACCOUNT_LABELS: Record<ApiImportAccountAction, string> = {
  provision: 'Provision account',
  account_exists: 'Account exists',
  no_account: 'No account',
  account_conflict: 'ID conflict',
  error: 'Blocked',
};

export const TEACHER_ACCOUNT_BADGE_VARIANT: Record<ApiImportAccountAction, TeacherAccountBadgeVariant> = {
  provision: 'info',
  account_exists: 'success',
  no_account: 'outline',
  account_conflict: 'danger',
  error: 'danger',
};

export interface TeacherAccountRowDisplay {
  action: ApiImportAccountAction | null;
  label: string;
  variant: TeacherAccountBadgeVariant;
  username: string | null;
  mustChangePassword: boolean | null;
  message: string;
}

/** Read-only account consequence for one row (safe: no passwords on the client). */
export function teacherAccountActionForRow(account: ApiImportRowAccount | null | undefined): TeacherAccountRowDisplay {
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
    label: TEACHER_ACCOUNT_LABELS[account.action] ?? account.action,
    variant: TEACHER_ACCOUNT_BADGE_VARIANT[account.action] ?? 'outline',
    username: account.username ?? null,
    mustChangePassword: account.must_change_password ?? null,
    message: account.message,
  };
}

/** Human summary of the rolled-up account plan counts. */
export function teacherAccountPlanSummary(accounts: ApiAccountPlanCounts | null | undefined): string {
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