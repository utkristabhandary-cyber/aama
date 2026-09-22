import { describe, it, expect } from 'vitest';
import type {
  ApiImportIssue,
  ApiStudentImportRow,
  ApiStudentImportSummary,
} from '../../types/api';
import {
  accountActionForRow,
  accountPlanSummary,
  countStudentPlans,
  fieldChangeSummary,
  isStudentImportBlocked,
  issueCountsBySeverity,
  partitionStudentRows,
  placementSummary,
  rowIssueCodes,
  studentRowDisplay,
  worstStudentRowSeverity,
} from './studentImportPresentation';

function makeRow(overrides: Partial<ApiStudentImportRow>): ApiStudentImportRow {
  return {
    row: 3,
    cells: { '0': 'STD-001' },
    normalized: {},
    issues: [],
    severity: 'valid',
    status: 'data',
    classification: 'new',
    identity: null,
    db_match: null,
    plan: 'new',
    values: {},
    placement: null,
    field_changes: [],
    ...overrides,
  };
}

describe('studentImportPresentation', () => {
  it('partitions rows by plan', () => {
    const rows = [
      makeRow({ row: 1, plan: 'new' }),
      makeRow({ row: 2, plan: 'update' }),
      makeRow({ row: 3, plan: 'unchanged' }),
      makeRow({ row: 4, plan: 'duplicate' }),
      makeRow({ row: 5, plan: 'error' }),
    ];
    const groups = partitionStudentRows(rows);
    expect(groups.newRows.map(r => r.row)).toEqual([1]);
    expect(groups.updateRows.map(r => r.row)).toEqual([2]);
    expect(groups.unchangedRows.map(r => r.row)).toEqual([3]);
    expect(groups.duplicateRows.map(r => r.row)).toEqual([4]);
    expect(groups.errorRows.map(r => r.row)).toEqual([5]);
  });

  it('counts plans deterministically', () => {
    const rows = [
      makeRow({ plan: 'new' }),
      makeRow({ plan: 'new' }),
      makeRow({ plan: 'error' }),
      makeRow({ plan: 'duplicate' }),
    ];
    expect(countStudentPlans(rows)).toEqual({
      new: 2,
      update: 0,
      unchanged: 0,
      duplicate: 1,
      error: 1,
    });
  });

  it('mirrors the backend block gate', () => {
    expect(
      isStudentImportBlocked({ block_confirmation: true } as ApiStudentImportSummary),
    ).toBe(true);
    expect(
      isStudentImportBlocked({ block_confirmation: false } as ApiStudentImportSummary),
    ).toBe(false);
  });

  it('renders row display values from server values', () => {
    const row = makeRow({
      values: {
        student_id: 'STD-001',
        name: 'Alice',
        email: 'alice@aams.local',
        roll_no: '07',
      },
      placement: {
        semester: { id: 4, code: 'SEM-S4', name: 'Semester 4' },
        section: 'A',
        program_token: 'CSE',
      },
    });
    expect(studentRowDisplay(row)).toEqual({
      studentId: 'STD-001',
      name: 'Alice',
      email: 'alice@aams.local',
      rollNo: '07',
      semester: 'Semester 4',
      section: 'A',
      placementLabel: 'A (CSE) / Semester 4',
    });
  });

  it('summarizes field changes', () => {
    expect(fieldChangeSummary([])).toBe('No changes');
    expect(
      fieldChangeSummary([
        { field: 'name', label: 'Full Name', old: 'Alice', new: 'Alice Updated' },
      ]),
    ).toBe('Full Name: Alice → Alice Updated');
  });

  it('summarizes placement incl change flag', () => {
    expect(placementSummary(null)).toBe('No placement');
    expect(
      placementSummary({ semester: { id: 4, code: 'SEM-S4', name: 'Semester 4' }, section: 'A', program_token: null, placement_change: true }),
    ).toBe('Placement change');
    expect(
      placementSummary({ semester: { id: 4, code: 'SEM-S4', name: 'Semester 4' }, section: 'A', program_token: null }),
    ).toBe('A / Semester 4');
  });

  it('computes worst severity from issue list mirroring the engine', () => {
    const row = makeRow({
      issues: [
        { severity: 'warning', code: 'placement_blank', message: 'x' },
        { severity: 'error', code: 'semester_unknown', message: 'y' },
      ],
    });
    expect(worstStudentRowSeverity(row)).toBe('error');
    expect(rowIssueCodes(row)).toEqual(['placement_blank', 'semester_unknown']);
  });

  it('counts issues by severity', () => {
    const issues: ApiImportIssue[] = [
      { severity: 'error', code: 'a', message: 'a' },
      { severity: 'warning', code: 'b', message: 'b' },
      { severity: 'suspicious', code: 'c', message: 'c' },
    ];
    expect(issueCountsBySeverity(issues)).toEqual({
      valid: 0,
      warning: 1,
      suspicious: 1,
      error: 1,
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
      expect(accountActionForRow({ action: action as never, username: 'STD-1', role: 'student', must_change_password: action === 'provision', message: 'm' })).toMatchObject({
        action,
        label,
        username: 'STD-1',
        mustChangePassword: action === 'provision',
        message: 'm',
      });
    }
  });

  it('handles a missing account consequence', () => {
    const row = accountActionForRow(undefined);
    expect(row).toMatchObject({ action: null, label: '—', variant: 'outline' });
  });

  it('summarizes account plan counts', () => {
    expect(accountPlanSummary(undefined)).toBe('No account changes planned.');
    expect(
      accountPlanSummary({ provision: 12, account_exists: 3, no_account: 1, conflict: 2 }),
    ).toBe('12 new logins will be created • 3 already exist • 1 no login • 2 conflicts');
    expect(accountPlanSummary({ provision: 0, account_exists: 0, no_account: 0, conflict: 0 })).toBe(
      'No account changes planned.',
    );
  });
});