import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatTime,
  sectionsLabel,
  statusBadgeVariant,
  TIMESHEET_STATUS_LABELS,
  TIMESHEET_TYPE_LABELS,
  typeLabel,
} from './timesheetPresentation';

describe('statusBadgeVariant', () => {
  it('maps each workflow status to the canonical badge variant', () => {
    expect(statusBadgeVariant('draft')).toBe('warning');
    expect(statusBadgeVariant('submitted')).toBe('info');
    expect(statusBadgeVariant('confirmed')).toBe('success');
    expect(statusBadgeVariant('rejected')).toBe('danger');
  });
});

describe('typeLabel', () => {
  it('labels every entry type', () => {
    expect(typeLabel('class')).toBe('Class');
    expect(typeLabel('duty')).toBe('Duty');
    expect(typeLabel('other')).toBe('Other');
  });

  it('covers every status label', () => {
    expect(Object.keys(TIMESHEET_STATUS_LABELS).sort()).toEqual([
      'confirmed',
      'draft',
      'rejected',
      'submitted',
    ]);
    expect(Object.keys(TIMESHEET_TYPE_LABELS).sort()).toEqual(['class', 'duty', 'other']);
  });
});

describe('formatTime', () => {
  it('truncates the seconds that TimeField emits', () => {
    expect(formatTime('09:30:00')).toBe('09:30');
    expect(formatTime('23:59:59')).toBe('23:59');
  });

  it('falls back for missing values', () => {
    expect(formatTime('')).toBe('—');
    expect(formatTime(null)).toBe('—');
    expect(formatTime(undefined)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('renders sub-hour durations plainly', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(45)).toBe('45 min');
  });

  it('renders whole hours without a trailing minute part', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
  });

  it('renders hours plus remainder', () => {
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(150)).toBe('2h 30m');
  });
});

describe('sectionsLabel', () => {
  it('joins participating sections', () => {
    expect(sectionsLabel(['A', 'B'])).toBe('A + B');
  });

  it('falls back for combined-lecture-free entries', () => {
    expect(sectionsLabel([])).toBe('—');
  });
});