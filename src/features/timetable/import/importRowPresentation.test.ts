import { describe, it, expect } from 'vitest';
import {
  ApiTimetableImportIssue,
  ApiTimetableImportRow,
} from '../../../types/api';
import {
  detectRawColumns,
  formatImportTime,
  partitionImportRows,
  toImportRowView,
} from './importRowPresentation';

function makeRow(overrides: Partial<ApiTimetableImportRow>): ApiTimetableImportRow {
  return {
    row: 3,
    raw: { semester: 'SEM1', section: 'F25', day: 'Sunday', lecturer: 'Dr Sharma' },
    semester_label: 'SEM1-2026',
    module_code: 'CS101',
    module_title: 'Programming Fundamentals',
    lecturer: 'Dr Sharma',
    teacher_id: '',
    section_raw: 'F25',
    course: '',
    room: 'Lecture Hall 1',
    block: 'A',
    day: 'Sunday',
    start_time: '09:00:00',
    end_time: '10:00:00',
    hours_minutes: null,
    class_type: 'Lecture',
    semester: { id: 1, code: 'SEM1', name: 'Semester 1' },
    sections: [{ id: 4, name: 'F254' }],
    subject: { id: 9, code: 'CS101', name: 'Programming Fundamentals' },
    teacher: {
      id: 3,
      name: 'Rajesh Sharma',
      teacher_id: 'EMP-3',
      match_method: 'name',
      supplied_id: '',
      supplied_name: 'Dr Sharma',
    },
    plan: 'new',
    status: 'valid',
    issues: [],
    ...overrides,
  };
}

describe('formatImportTime', () => {
  it('trims seconds to HH:mm', () => {
    expect(formatImportTime('09:00:00')).toBe('09:00');
    expect(formatImportTime('14:30:00')).toBe('14:30');
  });

  it('returns blanks and already-short values unchanged', () => {
    expect(formatImportTime('')).toBe('');
    expect(formatImportTime('09:00')).toBe('09:00');
  });
});

describe('toImportRowView', () => {
  it('maps server fields into a display row', () => {
    const view = toImportRowView(makeRow({}));
    expect(view.rowNumber).toBe(3);
    expect(view.semester).toBe('SEM1 · Semester 1');
    expect(view.subject).toBe('CS101 · Programming Fundamentals');
    expect(view.lecturer).toBe('Rajesh Sharma');
    expect(view.sectionRaw).toBe('F25');
    expect(view.classType).toBe('Lecture');
    expect(view.room).toBe('Lecture Hall 1');
    expect(view.block).toBe('A');
    expect(view.day).toBe('Sunday');
    expect(view.startTime).toBe('09:00');
    expect(view.endTime).toBe('10:00');
    expect(view.plan).toBe('new');
    expect(view.status).toBe('valid');
  });

  it('surfaces teacher-ID resolution on the display row', () => {
    const view = toImportRowView(
      makeRow({
        teacher_id: 'EMP-3',
        lecturer: 'Dr Sharma',
        teacher: {
          id: 3,
          name: 'Rajesh Sharma',
          teacher_id: 'EMP-3',
          match_method: 'id',
          supplied_id: 'EMP-3',
          supplied_name: 'Dr Sharma',
        },
      }),
    );
    expect(view.lecturer).toBe('Rajesh Sharma');
    expect(view.teacherId).toBe('EMP-3');
    expect(view.teacherMatch).toBe('id');
    expect(view.teacherAamsId).toBe('EMP-3');
    expect(view.suppliedId).toBe('EMP-3');
    expect(view.suppliedName).toBe('Dr Sharma');
  });

  it('marks name-based resolution with match_method name', () => {
    const view = toImportRowView(
      makeRow({
        lecturer: 'Dr Sharma',
        teacher: {
          id: 3,
          name: 'Rajesh Sharma',
          teacher_id: 'EMP-3',
          match_method: 'name',
          supplied_id: '',
          supplied_name: 'Dr Sharma',
        },
      }),
    );
    expect(view.teacherMatch).toBe('name');
    expect(view.teacherAamsId).toBe('EMP-3');
    expect(view.suppliedId).toBe('');
  });

  it('prefers the resolved teacher reference over the raw lecturer label', () => {
    const view = toImportRowView(
      makeRow({
        lecturer: 'Dr Sharma',
        teacher: {
          id: 3,
          name: 'Rajesh Sharma',
          teacher_id: 'EMP-3',
          match_method: 'name',
          supplied_id: '',
          supplied_name: 'Dr Sharma',
        },
      }),
    );
    expect(view.lecturer).toBe('Rajesh Sharma');
  });

  it('handles unresolved rows gracefully', () => {
    const view = toImportRowView(
      makeRow({
        semester: null,
        subject: null,
        teacher: null,
        semester_label: 'Unmapped Sem',
        module_code: '',
        module_title: 'Lost Module',
        lecturer: '',
        room: '',
        day: '',
        start_time: '',
        end_time: '',
      }),
    );
    expect(view.semester).toBe('Unmapped Sem');
    expect(view.lecturer).toBe('—');
    expect(view.subject).toBe('Lost Module');
    expect(view.startTime).toBe('');
  });
});

describe('partitionImportRows', () => {
  it('buckets rows by backend status/plan without re-validating', () => {
    const rows = [
      makeRow({ row: 1, status: 'error', plan: 'error', issues: [{ level: 'error', code: 'UNKNOWN_TEACHER', message: 'No match' }] }),
      makeRow({ row: 2, status: 'warning', plan: 'new' }),
      makeRow({ row: 3, status: 'valid', plan: 'new' }),
      makeRow({ row: 4, status: 'update', plan: 'update' }),
      makeRow({ row: 5, status: 'duplicate', plan: 'duplicate' }),
      makeRow({ row: 6, status: 'unchanged', plan: 'unchanged' }),
    ];

    const parts = partitionImportRows(rows);
    expect(parts.errors.map(r => r.rowNumber)).toEqual([1]);
    expect(parts.warnings.map(r => r.rowNumber)).toEqual([2]);
    expect(parts.newRows.map(r => r.rowNumber)).toEqual([3]);
    expect(parts.updateRows.map(r => r.rowNumber)).toEqual([4]);
    expect(parts.duplicateRows.map(r => r.rowNumber)).toEqual([5]);
    expect(parts.unchangedRows.map(r => r.rowNumber)).toEqual([6]);
  });

  it('includes a warning-status update in both warning and update buckets', () => {
    const row = makeRow({ row: 7, status: 'warning', plan: 'update' });
    const parts = partitionImportRows([row]);
    expect(parts.warnings).toHaveLength(1);
    expect(parts.updateRows).toHaveLength(1);
  });

  it('surfaces the first issue for an error row', () => {
    const issue: ApiTimetableImportIssue = { level: 'error', code: 'UNKNOWN_SECTION', message: 'No matching section in SEM1.' };
    const parts = partitionImportRows([makeRow({ row: 1, status: 'error', plan: 'error', issues: [issue] })]);
    expect(parts.errors[0].issues).toEqual([issue]);
  });
});

describe('detectRawColumns', () => {
  it('returns recognized columns in first-seen order', () => {
    const rows = [
      makeRow({}),
      makeRow({ row: 4, raw: { ...makeRow({}).raw, remarks: 'x' } }),
    ];
    expect(detectRawColumns(rows)).toEqual(['semester', 'section', 'day', 'lecturer', 'remarks']);
  });

  it('returns an empty list for no rows', () => {
    expect(detectRawColumns([])).toEqual([]);
  });
});