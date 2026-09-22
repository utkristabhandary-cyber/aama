import { describe, it, expect } from 'vitest';
import {
  TEACHER_PLAN_LABELS,
  TEACHER_PLAN_BADGE_VARIANT,
  partitionTeacherRows,
  countTeacherPlans,
  isTeacherImportBlocked,
  teacherRowDisplay,
  teacherFieldChangeSummary,
  worstTeacherRowSeverity,
  teacherRowIssueCodes,
  teacherIssueCountsBySeverity,
  teacherAccountActionForRow,
  teacherAccountPlanSummary,
} from './teacherImportPresentation';
import type { ApiTeacherImportRow, ApiTeacherImportSummary } from '../../types/api';

function makeTable(name: string, plan: ApiTeacherImportRow['plan'], issues?: ApiTeacherImportRow['issues']): ApiTeacherImportRow {
  return {
    row: 2,
    cells: {},
    normalized: {},
    issues: issues || [],
    severity: 'valid',
    status: 'data',
    classification: plan,
    identity: { keys: [], values: {} },
    db_match: null,
    values: { teacher_id: 'T001', name },
    field_changes: [],
    plan,
  };
}

describe('teacher import presentation helpers', () => {
  it('labels every plan', () => {
    expect(TEACHER_PLAN_LABELS.new).toBe('New');
    expect(TEACHER_PLAN_LABELS.update).toBe('Update');
    expect(TEACHER_PLAN_LABELS.unchanged).toBe('Unchanged');
    expect(TEACHER_PLAN_LABELS.duplicate).toBe('Duplicate');
    expect(TEACHER_PLAN_LABELS.error).toBe('Error');
    expect(TEACHER_PLAN_BADGE_VARIANT.new).toBe('info');
    expect(TEACHER_PLAN_BADGE_VARIANT.error).toBe('danger');
  });

  it('partitions rows by plan', () => {
    const rows = [
      makeTable('New', 'new'),
      makeTable('Update', 'update'),
      makeTable('Dup', 'duplicate'),
      makeTable('Unchanged', 'unchanged'),
      makeTable('Err', 'error'),
      makeTable('New2', 'new'),
    ];
    const p = partitionTeacherRows(rows);
    expect(p.newRows).toHaveLength(2);
    expect(p.updateRows).toHaveLength(1);
    expect(p.unchangedRows).toHaveLength(1);
    expect(p.duplicateRows).toHaveLength(1);
    expect(p.errorRows).toHaveLength(1);
  });

  it('counts plans', () => {
    const rows = [
      makeTable('New', 'new'),
      makeTable('New', 'new'),
      makeTable('Update', 'update'),
      makeTable('Err', 'error'),
    ];
    expect(countTeacherPlans(rows)).toEqual({ new: 2, update: 1, unchanged: 0, duplicate: 0, error: 1 });
  });

  it('flags blocked import', () => {
    const blocked = { block_confirmation: true } as ApiTeacherImportSummary;
    const open = { block_confirmation: false } as ApiTeacherImportSummary;
    expect(isTeacherImportBlocked(blocked)).toBe(true);
    expect(isTeacherImportBlocked(open)).toBe(false);
  });

  it('builds row display from values', () => {
    const row = makeTable('Priya', 'new');
    row.values = {
      teacher_id: 'T001', name: 'Priya', email: 'priya@aams.local',
      phone: '9800000001', department: 'CSE', designation: 'Lecturer',
      qualification: 'M.Tech', status: 'active',
    };
    const d = teacherRowDisplay(row);
    expect(d.teacherId).toBe('T001');
    expect(d.department).toBe('CSE');
    expect(d.designation).toBe('Lecturer');
    expect(d.status).toBe('active');
  });

  it('summarizes field changes', () => {
    const summary = teacherFieldChangeSummary([
      { field: 'designation', label: 'Designation', old: 'Lecturer', new: 'Senior Lecturer' },
    ]);
    expect(summary).toBe('Designation: Lecturer → Senior Lecturer');
    expect(teacherFieldChangeSummary([])).toBe('No changes');
  });

  it('computes worst severity', () => {
    const suspicious = makeTable('X', 'new', [
      { severity: 'suspicious', code: 'status_unknown', message: 'x' },
    ]);
    const hybrid = makeTable('Y', 'error', [
      { severity: 'warning', code: 'w', message: 'w' },
      { severity: 'error', code: 'email_conflict', message: 'e' },
    ]);
    expect(worstTeacherRowSeverity(suspicious)).toBe('suspicious');
    expect(worstTeacherRowSeverity(hybrid)).toBe('error');
  });

  it('extracts issue codes and severity counts', () => {
    const issues = [
      { severity: 'error' as const, code: 'email_conflict', message: 'e' },
      { severity: 'warning' as const, code: 'unknown', message: 'w' },
      { severity: 'error' as const, code: 'missing_name', message: 'm' },
    ];
    const row = makeTable('X', 'error', issues);
    expect(teacherRowIssueCodes(row)).toEqual(['email_conflict', 'unknown', 'missing_name']);
    expect(teacherIssueCountsBySeverity(issues)).toEqual({
      valid: 0, warning: 1, suspicious: 0, error: 2,
    });
  });

  it('maps account actions to safe review labels', () => {
    const byAction: Record<string, string> = {
      provision: 'Provision account',
      account_exists: 'Account exists',
      no_account: 'No account',
      account_conflict: 'ID conflict',
      error: 'Blocked',
    };
    for (const [action, label] of Object.entries(byAction)) {
      expect(teacherAccountActionForRow({ action: action as never, username: 'T001', role: 'teacher', must_change_password: action === 'provision', message: 'm' })).toMatchObject({
        action,
        label,
        username: 'T001',
        mustChangePassword: action === 'provision',
        message: 'm',
      });
    }
  });

  it('handles a missing account consequence', () => {
    expect(teacherAccountActionForRow(undefined)).toMatchObject({
      action: null,
      label: '—',
      variant: 'outline',
    });
  });

  it('summarizes account plan counts', () => {
    expect(teacherAccountPlanSummary(null)).toBe('No account changes planned.');
    expect(
      teacherAccountPlanSummary({ provision: 1, account_exists: 0, no_account: 0, conflict: 0 }),
    ).toBe('1 new login will be created');
    expect(
      teacherAccountPlanSummary({ provision: 0, account_exists: 0, no_account: 0, conflict: 0 }),
    ).toBe('No account changes planned.');
  });
});