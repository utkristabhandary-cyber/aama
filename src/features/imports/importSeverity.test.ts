import { describe, it, expect } from 'vitest';
import type { ApiImportRow } from '../../types/api';
import {
  IMPORT_SEVERITY_LABEL,
  IMPORT_SEVERITY_ORDER,
  importSeverityBadgeVariant,
  worstImportSeverity,
} from './importSeverity';

function issue(severity: ApiImportRow['severity'], code: string) {
  return { severity, code, message: code };
}

describe('importSeverity', () => {
  it('keeps the strict engine ordering valid < warning < suspicious < error', () => {
    expect(IMPORT_SEVERITY_ORDER).toEqual(['valid', 'warning', 'suspicious', 'error']);
  });

  it('falls back to valid when there are no issues', () => {
    expect(worstImportSeverity([])).toBe('valid');
  });

  it('picks the highest severity present', () => {
    expect(
      worstImportSeverity([issue('warning', 'a'), issue('suspicious', 'b')]),
    ).toBe('suspicious');
  });

  it('error beats suspicious', () => {
    expect(
      worstImportSeverity([issue('suspicious', 'b'), issue('error', 'c')]),
    ).toBe('error');
  });

  it('maps severities to non-generic badge variants', () => {
    expect(importSeverityBadgeVariant('valid')).toBe('success');
    expect(importSeverityBadgeVariant('warning')).toBe('warning');
    expect(importSeverityBadgeVariant('suspicious')).toBe('info');
    expect(importSeverityBadgeVariant('error')).toBe('danger');
  });

  it('exposes stable human labels', () => {
    expect(IMPORT_SEVERITY_LABEL.error).toBe('Error');
    expect(IMPORT_SEVERITY_LABEL.suspicious).toBe('Suspicious');
  });
});