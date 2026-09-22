import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sectionAllocationService } from './sectionAllocationService';
import { studentService } from './studentService';
import { sectionService } from './sectionService';
import { Student, Section } from '../types';

const sem1 = { id: 'sem-1', name: 'Semester 1', code: 'SEM1-2026', academicYear: '2026-2027', startDate: '2026-01-01', endDate: '2026-06-30', status: 'active' as const };
const sem2 = { id: 'sem-2', name: 'Semester 2', code: 'SEM2-2026', academicYear: '2026-2027', startDate: '2026-07-01', endDate: '2026-12-31', status: 'active' as const };

const sections: Section[] = [
  { id: 'sec-11', name: 'Section A', semesterId: sem1.id, capacity: 40, room: 'R1' },
  { id: 'sec-21', name: 'Section A', semesterId: sem2.id, capacity: 40, room: 'R2' },
  { id: 'sec-22', name: 'Section B', semesterId: sem2.id, capacity: 42, room: 'R3' },
];

const students: Student[] = [
  { id: '10', studentId: 'STU-2026-001', rollNo: '01', name: 'Alice A', email: 'alice@aams.edu', phone: '1', semesterId: sem2.id, sectionId: 'sec-21', avatar: '', admissionYear: 2026, status: 'active' },
  { id: '11', studentId: 'STU-2026-002', rollNo: '02', name: 'Bob B', email: 'bob@aams.edu', phone: '2', semesterId: sem2.id, sectionId: null, avatar: '', admissionYear: 2026, status: 'active' },
  { id: '12', studentId: 'STU-2025-051', rollNo: '51', name: 'Carol C', email: 'carol@aams.edu', phone: '3', semesterId: sem1.id, sectionId: 'sec-11', avatar: '', admissionYear: 2025, status: 'active' },
  { id: '13', studentId: 'STU-2026-004', rollNo: '04', name: 'Dave D', email: 'dave@aams.edu', phone: '4', semesterId: sem2.id, sectionId: 'sec-22', avatar: '', admissionYear: 2026, status: 'active' },
];

describe('sectionAllocationService.previewSectionAllocationCSV', () => {
  beforeEach(() => {
    vi.spyOn(studentService, 'getStudents').mockResolvedValue([...students]);
    vi.spyOn(sectionService, 'getSections').mockResolvedValue([...sections]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies Change / No Change / REJECTED / Unallocated against the live roster', async () => {
    const csv = [
      'student_id,student_name,section',
      'STU-2026-001,Alice A,Section B',
      'STU-2026-002,Bob B,Section A',
      'STU-2025-051,Carol C,Section A',
      'STU-2026-999,Ghost,Section A',
    ].join('\n');

    const result = await sectionAllocationService.previewSectionAllocationCSV(csv, sem2.id);

    expect(result.isValidFormat).toBe(true);
    expect(result.summary).toEqual({
      totalRows: 5,
      validRows: 3,
      changedCount: 2,
      unchangedCount: 0,
      unallocatedCount: 1,
      rejectedCount: 2,
    });

    const byId = Object.fromEntries(result.rows.map(r => [r.studentId, r]));
    expect(byId['STU-2026-001'].status).toBe('Change');
    expect(byId['STU-2026-001'].resolvedStudentDbId).toBe('10');
    expect(byId['STU-2026-001'].resolvedSectionDbId).toBe('sec-22');
    expect(byId['STU-2026-002'].status).toBe('Change');
    expect(byId['STU-2026-002'].resolvedSectionDbId).toBe('sec-21');
    expect(byId['STU-2025-051'].status).toBe('REJECTED');
    expect(byId['STU-2025-051'].reason).toContain('different semester');
    expect(byId['STU-2026-999'].status).toBe('REJECTED');
    expect(byId['STU-2026-004'].status).toBe('Unallocated');
    expect(byId['STU-2026-004'].currentSectionName).toBe('Section B');
  });

  it('marks a row as No Change when the target section matches the current one', async () => {
    const csv = ['student_id,student_name,section', 'STU-2026-001,Alice A,Section A'].join('\n');
    const result = await sectionAllocationService.previewSectionAllocationCSV(csv, sem2.id);

    expect(result.summary.changedCount).toBe(0);
    expect(result.summary.unchangedCount).toBe(1);
    expect(result.rows[0].status).toBe('No Change');
  });

  it('rejects a section that does not exist in the target semester', async () => {
    const csv = ['student_id,student_name,section', 'STU-2026-001,Alice A,Section Z'].join('\n');
    const result = await sectionAllocationService.previewSectionAllocationCSV(csv, sem2.id);

    expect(result.rows[0].status).toBe('REJECTED');
    expect(result.rows[0].reason).toContain('does not exist');
    expect(result.summary.rejectedCount).toBe(1);
  });

  it('rejects an invalid header format without calling services', async () => {
    const csv = ['roll,section', 'x,Section A'].join('\n');
    const result = await sectionAllocationService.previewSectionAllocationCSV(csv, sem2.id);

    expect(result.isValidFormat).toBe(false);
    expect(result.errors.join(' ')).toContain('Invalid CSV header format');
  });
});

describe('sectionAllocationService.applySectionAllocation', () => {
  it('PATCHes section changes and clears sections for unallocated students', async () => {
    const res = await sectionAllocationService.previewSectionAllocationCSV(
      ['student_id,student_name,section', 'STU-2026-001,Alice A,Section B'].join('\n'),
      sem2.id,
    );

    const patch = vi.spyOn(studentService, 'updateSectionAssignment').mockResolvedValue(students[0]);

    const outcome = await sectionAllocationService.applySectionAllocation(res);

    expect(outcome).toEqual({ success: true, appliedCount: 1, unallocatedCount: 2 });
    expect(patch).toHaveBeenCalledWith('10', 'sec-22');
    expect(patch).toHaveBeenCalledWith('11', null);
    expect(patch).toHaveBeenCalledWith('13', null);
  });

  it('rejects with the first PATCH error and never claims full success', async () => {
    const res = await sectionAllocationService.previewSectionAllocationCSV(
      ['student_id,student_name,section', 'STU-2026-001,Alice A,Section B'].join('\n'),
      sem2.id,
    );

    vi.spyOn(studentService, 'updateSectionAssignment')
      .mockResolvedValueOnce(students[0])
      .mockRejectedValueOnce(new Error('section mismatch'));

    await expect(sectionAllocationService.applySectionAllocation(res)).rejects.toThrow('section mismatch');
  });

  beforeEach(() => {
    vi.spyOn(studentService, 'getStudents').mockResolvedValue([...students]);
    vi.spyOn(sectionService, 'getSections').mockResolvedValue([...sections]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});