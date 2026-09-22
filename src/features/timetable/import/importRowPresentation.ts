import { ApiTimetableImportIssue, ApiTimetableImportRow } from '../../../types/api';

/** Convert a backend "HH:mm:ss" value to "HH:mm" (or return blank/unchanged). */
export function formatImportTime(value: string): string {
  const trimmed = `${value || ''}`.trim();
  if (!trimmed) return '';
  const [hh, mm, _ss] = trimmed.split(':');
  if (hh && mm !== undefined) return `${hh}:${mm}`;
  return trimmed;
}

/** Teacher-identity resolution (Phase E). "id" = resolved by Teacher.teacher_id. */
export type TeacherMatchMethod = 'id' | 'name';

export interface TimetableImportRowView {
  rowNumber: number;
  semester: string;
  moduleCode: string;
  moduleTitle: string;
  subject: string;
  lecturer: string;
  sectionRaw: string;
  sectionsExpanded: string[];
  isCombined: boolean;
  classType: string;
  room: string;
  block: string;
  day: string;
  startTime: string;
  endTime: string;
  status: string;
  plan: string;
  issues: ApiTimetableImportIssue[];
  /** Institutional teacher-id column value supplied in the workbook ('' when absent). */
  teacherId: string;
  /** How the backend resolved the row's teacher; null when it could not. */
  teacherMatch: TeacherMatchMethod | null;
  /** Teacher.teacher_id of the AAMS teacher record that was matched. */
  teacherAamsId: string;
  /** Raw lecturer/name value supplied in the workbook. */
  suppliedName: string;
  /** Raw teacher-id value supplied in the workbook. */
  suppliedId: string;
}

/** Thin, read-only mapping of a server-planned row into what the UI renders. */
export function toImportRowView(row: ApiTimetableImportRow): TimetableImportRowView {
  const moduleCode = row.module_code || '';
  const moduleTitle = row.module_title || '';
  const subject =
    moduleCode && moduleTitle
      ? `${moduleCode} · ${moduleTitle}`
      : moduleCode || moduleTitle || '';

  return {
    rowNumber: row.row,
    semester: row.semester ? `${row.semester.code} · ${row.semester.name}` : row.semester_label || '—',
    moduleCode,
    moduleTitle,
    subject,
    lecturer: row.teacher?.name || row.lecturer || '—',
    sectionRaw: row.section_raw || '—',
    sectionsExpanded: row.sections_expanded ?? [],
    isCombined: row.is_combined ?? false,
    classType: row.class_type || 'Lecture',
    room: row.room || '—',
    block: row.block || '',
    day: row.day || '—',
    startTime: formatImportTime(row.start_time),
    endTime: formatImportTime(row.end_time),
    status: row.status,
    plan: row.plan,
    issues: row.issues ?? [],
    teacherId: row.teacher_id || '',
    teacherMatch: row.teacher?.match_method ?? null,
    teacherAamsId: row.teacher?.teacher_id || '',
    suppliedName: row.teacher?.supplied_name || row.lecturer || '',
    suppliedId: row.teacher?.supplied_id || row.teacher_id || '',
  };
}

export interface ImportRowPartitions {
  errors: TimetableImportRowView[];
  warnings: TimetableImportRowView[];
  newRows: TimetableImportRowView[];
  updateRows: TimetableImportRowView[];
  duplicateRows: TimetableImportRowView[];
  unchangedRows: TimetableImportRowView[];
  valid: TimetableImportRowView[];
}

/**
 * Partition server rows by the backend's plan/status classification.
 * No client-side re-validation happens here; this only groups the verdicts.
 */
export function partitionImportRows(rows: ApiTimetableImportRow[]): ImportRowPartitions {
  const groups: ImportRowPartitions = {
    errors: [],
    warnings: [],
    newRows: [],
    updateRows: [],
    duplicateRows: [],
    unchangedRows: [],
    valid: [],
  };

  for (const row of rows) {
    const view = toImportRowView(row);
    switch (row.status) {
      case 'error':
        groups.errors.push(view);
        break;
      case 'warning':
        groups.warnings.push(view);
        break;
      case 'duplicate':
        groups.duplicateRows.push(view);
        break;
      case 'unchanged':
        groups.unchangedRows.push(view);
        break;
      case 'update':
        groups.updateRows.push(view);
        break;
      default:
        groups.valid.push(view);
    }
    if (row.plan === 'new' && row.status === 'valid') groups.newRows.push(view);
    if (row.plan === 'update' && row.status === 'warning') groups.updateRows.push(view);
  }
  return groups;
}

/**
 * Column names as extracted by the server, in first-seen order. Used only to
 * preview which spreadsheet columns were recognized; the backend remains the
 * authority on column mapping.
 */
export function detectRawColumns(rows: ApiTimetableImportRow[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.raw || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}