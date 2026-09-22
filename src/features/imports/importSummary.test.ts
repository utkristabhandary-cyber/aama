import { describe, it, expect } from 'vitest';
import type { ApiImportCounts, ApiImportRow, ApiImportSummary } from '../../types/api';
import {
  countRowsBySeverity,
  importCountsLabel,
  isImportBlocked,
  partitionImportRows,
  rowIssueCodes,
} from './importSummary';

function makeRow(overrides: Partial<ApiImportRow>): ApiImportRow {
  return {
    row: 3,
    cells: { '1': 'STD-001' },
    normalized: { '1': 'STD-001' },
    issues: [],
    severity: 'valid',
    status: 'data',
    classification: 'new',
    identity: null,
    db_match: null,
    plan: null,
    ...overrides,
  };
}

describe('importSummary', () => {
  it('partitions rows by worst severity', () => {
    const rows = [
      makeRow({ row: 1, severity: 'valid' }),
      makeRow({ row: 2, severity: 'suspicious' }),
      makeRow({ row: 3, severity: 'error' }),
    ];
    const groups = partitionImportRows(rows);
    expect(groups.valid.map(r => r.row)).toEqual([1]);
    expect(groups.suspicious.map(r => r.row)).toEqual([2]);
    expect(groups.errors.map(r => r.row)).toEqual([3]);
  });

  it('counts rows by severity', () => {
    const rows = [
      makeRow({ severity: 'valid' }),
      makeRow({ severity: 'suspicious' }),
      makeRow({ severity: 'error' }),
      makeRow({ severity: 'error' }),
    ];
    expect(countRowsBySeverity(rows)).toEqual({
      valid: 1,
      warning: 0,
      suspicious: 1,
      error: 2,
    });
  });

  it('mirrors the backend confirmation gate', () => {
    expect(isImportBlocked({ block_confirmation: true } as ApiImportSummary)).toBe(true);
    expect(isImportBlocked({ block_confirmation: false } as ApiImportSummary)).toBe(false);
  });

  it('builds a compact, deterministic counts label', () => {
    const counts = {
      error_rows: 2,
      suspicious_rows: 1,
      warning_rows: 0,
      valid_rows: 4,
    } as unknown as ApiImportCounts;
    expect(importCountsLabel(counts)).toBe('2 errors · 1 suspicious · 4 valid rows');
    expect(importCountsLabel({} as ApiImportCounts)).toBe('No rows');
    expect(
      importCountsLabel({ error_rows: 1 } as unknown as ApiImportCounts),
    ).toBe('1 error');
  });

  it('extracts stable issue codes for the UI', () => {
    const row = makeRow({
      issues: [
        { severity: 'error', code: 'duplicate_identical', message: 'x' },
        { severity: 'warning', code: 'empty_column', message: 'y' },
      ],
    });
    expect(rowIssueCodes(row)).toEqual(['duplicate_identical', 'empty_column']);
  });
});