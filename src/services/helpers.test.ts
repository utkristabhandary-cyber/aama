import { describe, it, expect } from 'vitest';
import { errorMessage } from './apiClient';
import { toNotificationItem } from './notificationService';
import { reportService } from './reportService';

describe('apiClient.errorMessage', () => {
  it('returns string payloads verbatim', () => {
    expect(errorMessage('bad request')).toBe('bad request');
  });

  it('flattens DRF field-error arrays', () => {
    expect(errorMessage({ title: ['This field is required.', 'Too long.'] })).toBe(
      'This field is required. Too long.',
    );
  });

  it('flattens nested non-field errors', () => {
    expect(errorMessage({ detail: { date: ['Invalid date.'] } })).toBe('Invalid date.');
  });

  it('falls back for empty/unknown payloads', () => {
    expect(errorMessage(null)).toBe('Request failed (null)');
    expect(errorMessage(undefined)).toBe('Request failed (undefined)');
  });
});

describe('notificationService.toNotificationItem', () => {
  it('maps backend fields to the UI-facing notification shape', () => {
    const item = toNotificationItem({
      id: 7,
      title: 'Welcome',
      message: 'Hello',
      notification_type: 'warning',
      is_read: false,
      created_at: '2026-09-09T08:00:00Z',
    });

    expect(item.id).toBe('7');
    expect(item.type).toBe('warning');
    expect(item.isRead).toBe(false);
    expect(item.read).toBe(false);
    expect(item.timestamp).toBe('2026-09-09T08:00:00Z');
    expect(item.createdAt).toBe('2026-09-09T08:00:00Z');
  });

  it('defaults an empty notification type to info', () => {
    const item = toNotificationItem({
      id: 1,
      title: 'T',
      message: 'M',
      notification_type: '',
      is_read: true,
      created_at: '2026-09-09T00:00:00Z',
    });
    expect(item.type).toBe('info');
  });
});

describe('reportService.exportAttendanceReportCSV', () => {
  it('produces a header row plus one data row per record', () => {
    const csv = reportService.exportAttendanceReportCSV([
      { rollNo: '101', studentId: 'std-1', name: 'Ananya Verma', semesterName: 'SEM-S4', sectionName: 'A', total: 2, present: 1, absent: 1, late: 0, percentage: 50 },
    ]);

    expect(csv.split('\n').length).toBe(2);
    expect(csv).toContain('Attendance Percentage');
    expect(csv).toContain('DEFAULTER (<75%)');
  });

  it('quotes free-text fields to survive spreadsheet import', () => {
    const csv = reportService.exportAttendanceReportCSV([
      { studentId: 'std-1', studentName: 'Verma, Ananya', percentage: 90, total: 10, present: 9, absent: 0, late: 1 },
    ]);
    expect(csv).toContain('"Verma, Ananya"');
  });
});