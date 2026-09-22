import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_CONTRACTS,
  STUDENT_INSTITUTIONAL_HEADERS,
  TEACHER_SYSTEM_HEADERS,
  TIMETABLE_SYSTEM_HEADERS,
  TEACHER_TEMPLATE_LABEL,
  TIMETABLE_TEMPLATE_LABEL,
  requiredColumns,
} from './templateContract';

describe('templateContract student headers', () => {
  it('keeps exactly 59 institutional headers verbatim', () => {
    expect(STUDENT_INSTITUTIONAL_HEADERS).toHaveLength(59);
    expect(STUDENT_INSTITUTIONAL_HEADERS[0]).toBe('S.N.');
    expect(STUDENT_INSTITUTIONAL_HEADERS[3]).toBe('Roll Number');
    expect(STUDENT_INSTITUTIONAL_HEADERS[4]).toBe('Id Number');
    expect(STUDENT_INSTITUTIONAL_HEADERS).toContain('Familiar with Smartphone');
    expect(STUDENT_INSTITUTIONAL_HEADERS).toContain('Program/Sec.');
    expect(STUDENT_INSTITUTIONAL_HEADERS).toContain('Year/Semester');
    expect(STUDENT_INSTITUTIONAL_HEADERS[STUDENT_INSTITUTIONAL_HEADERS.length - 1]).toBe(
      'Sponsor Name',
    );
  });
});

describe('templateContract system headers', () => {
  it('exposes 8 teacher headers', () => {
    expect(TEACHER_SYSTEM_HEADERS).toHaveLength(8);
    expect(TEACHER_SYSTEM_HEADERS[0]).toBe('Teacher ID');
  });

  it('exposes 11 timetable headers', () => {
    expect(TIMETABLE_SYSTEM_HEADERS).toHaveLength(11);
    expect(TIMETABLE_SYSTEM_HEADERS[0]).toBe('Semester');
    expect(TIMETABLE_SYSTEM_HEADERS).toContain('Module Code');
  });
});

describe('templateContract labels and statuses', () => {
  it('marks the student template as the official institutional format', () => {
    expect(TEMPLATE_CONTRACTS.students.label).toContain('Official Institutional');
    expect(TEMPLATE_CONTRACTS.students.status['S.N.']).toBe('positional');
    expect(TEMPLATE_CONTRACTS.students.status['ID']).toBe('required');
    expect(TEMPLATE_CONTRACTS.students.status['Gender']).toBe('informational');
    expect(TEMPLATE_CONTRACTS.students.status['Religion']).toBe('not_stored');
  });

  it('labels teacher and timetable templates as current AAMS system format', () => {
    expect(TEACHER_TEMPLATE_LABEL).toContain('CURRENT AAMS SYSTEM FORMAT');
    expect(TIMETABLE_TEMPLATE_LABEL).toContain('CURRENT AAMS SYSTEM FORMAT');
  });

  it('sizes the status maps against the headers', () => {
    expect(Object.keys(TEMPLATE_CONTRACTS.teachers.status)).toHaveLength(
      TEACHER_SYSTEM_HEADERS.length,
    );
    expect(Object.keys(TEMPLATE_CONTRACTS.timetable.status)).toHaveLength(
      TIMETABLE_SYSTEM_HEADERS.length,
    );
  });
});

describe('requiredColumns', () => {
  it('flags the columns the server strictly requires per kind', () => {
    expect(requiredColumns('students')).toEqual(['Student ID', 'Name', 'Email', 'Roll Number']);
    expect(requiredColumns('teachers')).toEqual(['Teacher ID', 'Name', 'Email']);
    expect(requiredColumns('timetable')).toEqual(['Semester', 'Section', 'Day', 'Start Time']);
  });

  it('reports nothing for an unknown kind', () => {
    expect(requiredColumns('nope')).toEqual([]);
  });
});

describe('templateContract filenames', () => {
  it('uses distinct, kind-specific file names', () => {
    const names = [
      TEMPLATE_CONTRACTS.students.templateFilename,
      TEMPLATE_CONTRACTS.students.exportFilename,
      TEMPLATE_CONTRACTS.teachers.templateFilename,
      TEMPLATE_CONTRACTS.teachers.exportFilename,
      TEMPLATE_CONTRACTS.timetable.templateFilename,
      TEMPLATE_CONTRACTS.timetable.exportFilename,
    ];
    expect(new Set(names).size).toBe(6);
    expect(names.every(n => n.endsWith('.xlsx'))).toBe(true);
  });
});