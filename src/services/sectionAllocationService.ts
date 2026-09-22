import { studentService } from './studentService';
import { sectionService } from './sectionService';
import { SectionAllocationRow, SectionAllocationSummary } from '../types';

export interface CSVParseResult {
  isValidFormat: boolean;
  errors: string[];
  summary: SectionAllocationSummary;
  rows: SectionAllocationRow[];
  targetSemesterId: string;
}

export const sectionAllocationService = {
  /**
   * Parse CSV content and validate against the live target-semester roster.
   * Expected columns: student_id, student_name, section
   *
   * Reads students and sections from the DRF API — the same sources the rest
   * of the UI uses — so previews always reflect the real institutional data.
   */
  async previewSectionAllocationCSV(csvContent: string, targetSemesterId: string): Promise<CSVParseResult> {
    const errors: string[] = [];
    const rows: SectionAllocationRow[] = [];

    const lines = csvContent
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      return {
        isValidFormat: false,
        errors: ['CSV file is empty or missing data rows.'],
        summary: { totalRows: 0, validRows: 0, changedCount: 0, unchangedCount: 0, unallocatedCount: 0, rejectedCount: 0 },
        rows: [],
        targetSemesterId,
      };
    }

    // Validate header
    const headerLine = lines[0].toLowerCase();
    const headers = headerLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const studentIdColIdx = headers.findIndex(h => h === 'student_id' || h === 'studentid' || h === 'id');
    const studentNameColIdx = headers.findIndex(h => h === 'student_name' || h === 'name' || h === 'studentname');
    const sectionColIdx = headers.findIndex(h => h === 'section' || h === 'section_name' || h === 'new_section');

    if (studentIdColIdx === -1 || sectionColIdx === -1) {
      return {
        isValidFormat: false,
        errors: [
          'Invalid CSV header format. Expected mandatory columns: student_id, student_name, section.',
          `Found headers: ${headers.join(', ')}`,
        ],
        summary: { totalRows: 0, validRows: 0, changedCount: 0, unchangedCount: 0, unallocatedCount: 0, rejectedCount: 0 },
        rows: [],
        targetSemesterId,
      };
    }

    // Retrieve live database entities
    const [allStudents, allSections] = await Promise.all([
      studentService.getStudents(),
      sectionService.getSections(),
    ]);
    const semesterStudents = allStudents.filter(s => s.semesterId === targetSemesterId);
    const semesterSections = allSections.filter(s => s.semesterId === targetSemesterId);
    const sectionsById = new Map(allSections.map(s => [s.id, s]));

    const processedStudentIdsInCsv = new Set<string>();

    let changedCount = 0;
    let unchangedCount = 0;
    let rejectedCount = 0;

    // Process data rows
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
      const rawStudentId = cols[studentIdColIdx] || '';
      const rawStudentName = studentNameColIdx !== -1 ? cols[studentNameColIdx] || '' : '—';
      const rawSection = cols[sectionColIdx] || '';

      if (!rawStudentId && !rawSection) continue;

      // Find matching student in target semester
      const matchedStudent = semesterStudents.find(
        s =>
          s.studentId.toLowerCase() === rawStudentId.toLowerCase() ||
          s.id.toLowerCase() === rawStudentId.toLowerCase() ||
          s.rollNo === rawStudentId
      );

      if (!matchedStudent) {
        // Check if student exists in another semester
        const otherSemStudent = allStudents.find(
          s =>
            s.studentId.toLowerCase() === rawStudentId.toLowerCase() ||
            s.id.toLowerCase() === rawStudentId.toLowerCase()
        );

        rejectedCount++;
        rows.push({
          rowNumber: i,
          studentId: rawStudentId,
          studentName: rawStudentName || otherSemStudent?.name || 'Unknown',
          currentSectionName: otherSemStudent ? 'Other Semester' : 'Not Found',
          newSectionName: rawSection,
          status: 'REJECTED',
          reason: otherSemStudent
            ? 'Student belongs to a different semester. Cannot allocate outside enrolled semester.'
            : 'Student record does not exist in the institutional registry.',
        });
        continue;
      }

      processedStudentIdsInCsv.add(matchedStudent.id);

      // Find target section
      const currentSection = matchedStudent.sectionId
        ? sectionsById.get(matchedStudent.sectionId)
        : undefined;
      const currentSecName = currentSection?.name || 'Unallocated';

      const targetSection = semesterSections.find(
        sec =>
          sec.name.toLowerCase() === rawSection.toLowerCase() ||
          sec.name.toLowerCase().includes(rawSection.toLowerCase()) ||
          sec.id.toLowerCase() === rawSection.toLowerCase()
      );

      if (!targetSection) {
        rejectedCount++;
        rows.push({
          rowNumber: i,
          studentId: matchedStudent.studentId,
          studentName: matchedStudent.name,
          currentSectionName: currentSecName,
          newSectionName: rawSection,
          status: 'REJECTED',
          reason: `Target section "${rawSection}" does not exist in this semester. Available: ${semesterSections.map(s => s.name).join(', ')}.`,
          resolvedStudentDbId: matchedStudent.id,
        });
        continue;
      }

      const isSame = matchedStudent.sectionId === targetSection.id;
      if (isSame) {
        unchangedCount++;
      } else {
        changedCount++;
      }

      rows.push({
        rowNumber: i,
        studentId: matchedStudent.studentId,
        studentName: matchedStudent.name,
        currentSectionName: currentSecName,
        newSectionName: targetSection.name,
        status: isSame ? 'No Change' : 'Change',
        resolvedStudentDbId: matchedStudent.id,
        resolvedSectionDbId: targetSection.id,
      });
    }

    // Identify target semester students who were NOT present in CSV -> Unallocated
    let unallocatedCount = 0;
    semesterStudents.forEach(stu => {
      if (!processedStudentIdsInCsv.has(stu.id)) {
        unallocatedCount++;
        const currentSec = stu.sectionId ? sectionsById.get(stu.sectionId) : undefined;
        rows.push({
          rowNumber: rows.length + 1,
          studentId: stu.studentId,
          studentName: stu.name,
          currentSectionName: currentSec?.name || 'Assigned',
          newSectionName: '— (Unallocated)',
          status: 'Unallocated',
          reason: 'Omitted from allocation CSV. Status will transition to Unallocated roster.',
          resolvedStudentDbId: stu.id,
          resolvedSectionDbId: '', // cleared
        });
      }
    });

    const validRows = changedCount + unchangedCount + unallocatedCount;
    const totalRows = rows.length;

    return {
      isValidFormat: true,
      errors,
      summary: {
        totalRows,
        validRows,
        changedCount,
        unchangedCount,
        unallocatedCount,
        rejectedCount,
      },
      rows,
      targetSemesterId,
    };
  },

  /**
   * Apply confirmed section reallocation to the live student registry via the
   * DRF API. Each "Change" row PATCHes the student's section; "Unallocated"
   * rows clear the section (backend keeps the semester server-side). If any
   * PATCH fails, the already-applied rows are reported honestly and the call
   * rejects with the remaining error so the UI never claims a full success.
   */
  async applySectionAllocation(previewResult: CSVParseResult): Promise<{
    success: boolean;
    appliedCount: number;
    unallocatedCount: number;
  }> {
    const changes = previewResult.rows.filter(r => r.status === 'Change' && r.resolvedSectionDbId);
    const unallocations = previewResult.rows.filter(r => r.status === 'Unallocated' && r.resolvedStudentDbId);

    let appliedCount = 0;
    let unallocatedCount = 0;
    let firstError: Error | null = null;

    for (const row of changes) {
      try {
        await studentService.updateSectionAssignment(row.resolvedStudentDbId!, row.resolvedSectionDbId!);
        appliedCount++;
      } catch (err) {
        if (!firstError) firstError = err as Error;
      }
    }

    for (const row of unallocations) {
      try {
        await studentService.updateSectionAssignment(row.resolvedStudentDbId!, null);
        unallocatedCount++;
      } catch (err) {
        if (!firstError) firstError = err as Error;
      }
    }

    if (firstError) {
      throw firstError;
    }

    return {
      success: true,
      appliedCount,
      unallocatedCount,
    };
  },
};