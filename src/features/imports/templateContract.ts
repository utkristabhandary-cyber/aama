/** Workbook contract metadata for the import UI (Phase H).
 *
 * Mirrors ``backend/apps/imports/contracts.py`` — that module is the
 * authoritative source; keep statuses, labels and counts in sync with it.
 * This module powers the required-field guidance and template labelling so the
 * admin always sees what the server actually enforces (and the truthful
 * "official institutional" vs "current AAMS system format" distinction).
 */

export type ImportColumnStatus =
  | 'required'
  | 'mapped'
  | 'informational'
  | 'positional'
  | 'not_stored';

export interface TemplateContract {
  kind: 'students' | 'teachers' | 'timetable';
  /** Truthful label rendered next to the template download button. */
  label: string;
  /** Template .xlsx filename the server sends in Content-Disposition. */
  templateFilename: string;
  /** Export .xlsx filename the server sends in Content-Disposition. */
  exportFilename: string;
  /** Headers of the download template / export workbook. */
  headers: string[];
  /** Status per header (authority: contracts.py). */
  status: Record<string, ImportColumnStatus>;
  /** Canonical importer field per mapped header (students only). */
  field?: Record<string, string>;
  /** Flags required columns in header order. */
  required: string[];
  /** Free-text guidance shown under the uploader. */
  guidance: string;
}

export const IMPORT_STATUS_DESCRIPTIONS: Record<ImportColumnStatus, string> = {
  required: 'Required. The import is refused if this column is missing.',
  mapped: 'Optional. Stored when present and parseable.',
  informational: 'Recognised but NOT saved. The importer reports it and discards it.',
  positional: 'Worksheet row marker. Never treated as data.',
  not_stored:
    "Accepted but NOT stored. The institution's column is documented and safely ignored.",
};

export const STUDENT_TEMPLATE_LABEL =
  'AAMS Student Roster Template — Official Institutional Format';
export const TEACHER_TEMPLATE_LABEL =
  'AAMS Teacher Roster Template — CURRENT AAMS SYSTEM FORMAT';
export const TIMETABLE_TEMPLATE_LABEL =
  'AAMS Timetable Template — CURRENT AAMS SYSTEM FORMAT';

export const STUDENT_TEMPLATE_FILENAME = 'aams_student_import_template.xlsx';
export const TEACHER_TEMPLATE_FILENAME = 'aams_teacher_import_template.xlsx';
export const TIMETABLE_TEMPLATE_FILENAME = 'aams_timetable_import_template.xlsx';

export const STUDENT_EXPORT_FILENAME = 'aams_students_export.xlsx';
export const TEACHER_EXPORT_FILENAME = 'aams_teachers_export.xlsx';
export const TIMETABLE_EXPORT_FILENAME = 'aams_timetable_export.xlsx';

/** The 59 official institutional student headers, verbatim, in supplied order. */
export const STUDENT_INSTITUTIONAL_HEADERS: string[] = [
  'S.N.', 'ID', 'Name', 'Roll Number', 'Id Number', 'National ID No.',
  'DOB (A.D.)', 'DOB (B.S.)', 'Gender', 'Phone', 'Email', 'Perm. Address',
  'Temp. Address', 'Type', 'Program/Sec.', 'Year/Semester', 'Shift',
  'Previous School Name', 'Familiar with Smartphone', 'Religion', 'Ethnic Group',
  'Blood Group', 'Disability', 'Mother Tongue', 'EMIS ID', 'Symbol No.',
  'Registration No.', 'House', 'Referred By', 'Label', 'Joined Date',
  "Father's Name", "Father's Phone", "Mother's Name", "Mother's Phone",
  "Local Guardian's Name", "Local Guardian's Phone", 'Current Guardian', 'Status',
  'Lunch', 'Lunch Type', 'Perm State', 'Perm District', 'Perm City',
  'Perm Municipality', 'Perm Ward No.', 'Perm House No.', 'Perm Telephone No.',
  'Perm Street', 'Temp State', 'Temp District', 'Temp City', 'Temp Municipality',
  'Temp Ward No.', 'Temp House No.', 'Temp Telephone No.', 'Temp Street', 'Remarks',
  'Sponsor Name',
];

export const TEACHER_SYSTEM_HEADERS: string[] = [
  'Teacher ID', 'Name', 'Email', 'Phone', 'Department', 'Designation',
  'Qualification', 'Status',
];

export const TIMETABLE_SYSTEM_HEADERS: string[] = [
  'Semester', 'Section', 'Day', 'Start Time', 'End Time', 'Module Code',
  'Module Title', 'Teacher ID', 'Lecturer', 'Class Type', 'Room',
];

export const STUDENT_HEADER_STATUS: Record<string, ImportColumnStatus> = {
  'S.N.': 'positional', 'ID': 'required', 'Name': 'required',
  'Roll Number': 'required', 'Id Number': 'not_stored',
  'National ID No.': 'not_stored', 'DOB (A.D.)': 'mapped', 'DOB (B.S.)': 'mapped',
  'Gender': 'informational', 'Phone': 'mapped', 'Email': 'required',
  'Perm. Address': 'mapped', 'Temp. Address': 'not_stored', 'Type': 'not_stored',
  'Program/Sec.': 'mapped', 'Year/Semester': 'mapped', 'Shift': 'not_stored',
  'Previous School Name': 'not_stored', 'Familiar with Smartphone': 'not_stored',
  'Religion': 'not_stored', 'Ethnic Group': 'not_stored', 'Blood Group': 'not_stored',
  'Disability': 'not_stored', 'Mother Tongue': 'not_stored', 'EMIS ID': 'not_stored',
  'Symbol No.': 'not_stored', 'Registration No.': 'not_stored', 'House': 'not_stored',
  'Referred By': 'not_stored', 'Label': 'not_stored', 'Joined Date': 'mapped',
  "Father's Name": 'mapped', "Father's Phone": 'mapped', "Mother's Name": 'not_stored',
  "Mother's Phone": 'not_stored', "Local Guardian's Name": 'not_stored',
  "Local Guardian's Phone": 'not_stored', 'Current Guardian': 'not_stored',
  'Status': 'mapped', 'Lunch': 'not_stored', 'Lunch Type': 'not_stored',
  'Perm State': 'not_stored', 'Perm District': 'not_stored', 'Perm City': 'not_stored',
  'Perm Municipality': 'not_stored', 'Perm Ward No.': 'not_stored',
  'Perm House No.': 'not_stored', 'Perm Telephone No.': 'not_stored',
  'Perm Street': 'not_stored', 'Temp State': 'not_stored',
  'Temp District': 'not_stored', 'Temp City': 'not_stored',
  'Temp Municipality': 'not_stored', 'Temp Ward No.': 'not_stored',
  'Temp House No.': 'not_stored', 'Temp Telephone No.': 'not_stored',
  'Temp Street': 'not_stored', 'Remarks': 'not_stored', 'Sponsor Name': 'not_stored',
};

export const TEACHER_HEADER_STATUS: Record<string, ImportColumnStatus> = {
  'Teacher ID': 'required', 'Name': 'required', 'Email': 'required',
  'Phone': 'mapped', 'Department': 'mapped', 'Designation': 'mapped',
  'Qualification': 'mapped', 'Status': 'mapped',
};

export const TIMETABLE_HEADER_STATUS: Record<string, ImportColumnStatus> = {
  'Semester': 'required', 'Section': 'required', 'Day': 'required',
  'Start Time': 'required', 'End Time': 'mapped', 'Module Code': 'mapped',
  'Module Title': 'mapped', 'Teacher ID': 'mapped', 'Lecturer': 'mapped',
  'Class Type': 'mapped', 'Room': 'mapped',
};

export const TEMPLATE_CONTRACTS: Record<string, TemplateContract> = {
  students: {
    kind: 'students',
    label: STUDENT_TEMPLATE_LABEL,
    templateFilename: STUDENT_TEMPLATE_FILENAME,
    exportFilename: STUDENT_EXPORT_FILENAME,
    headers: STUDENT_INSTITUTIONAL_HEADERS,
    status: STUDENT_HEADER_STATUS,
    field: {
      'DOB (A.D.)': 'dob',
      'DOB (B.S.)': 'dob_bs',
      'Phone': 'phone',
      'Perm. Address': 'address',
      'Program/Sec.': 'section',
      'Year/Semester': 'semester',
      'Joined Date': 'admission_year',
      "Father's Name": 'guardian_name',
      "Father's Phone": 'guardian_phone',
      'Status': 'status',
    },
    required: ['Student ID', 'Name', 'Email', 'Roll Number'],
    guidance:
      'The official institutional roster workbook. Only ID, Name, Email and ' +
      'Roll Number are mandatory; optional mapped columns (DOB (A.D.), Phone, ' +
      'Program/Sec., Year/Semester, Status, Joined Date, Father\u2019s Name, ' +
      'Father\u2019s Phone, Perm. Address) are stored when present.',
  },
  teachers: {
    kind: 'teachers',
    label: TEACHER_TEMPLATE_LABEL,
    templateFilename: TEACHER_TEMPLATE_FILENAME,
    exportFilename: TEACHER_EXPORT_FILENAME,
    headers: TEACHER_SYSTEM_HEADERS,
    status: TEACHER_HEADER_STATUS,
    required: ['Teacher ID', 'Name', 'Email'],
    guidance:
      'Current AAMS system format (no institutional teacher workbook has been ' +
      'supplied yet). Teacher ID, Name and Email are required.',
  },
  timetable: {
    kind: 'timetable',
    label: TIMETABLE_TEMPLATE_LABEL,
    templateFilename: TIMETABLE_TEMPLATE_FILENAME,
    exportFilename: TIMETABLE_EXPORT_FILENAME,
    headers: TIMETABLE_SYSTEM_HEADERS,
    status: TIMETABLE_HEADER_STATUS,
    required: ['Semester', 'Section', 'Day', 'Start Time'],
    guidance:
      'Current AAMS system format (no institutional timetable workbook has been ' +
      'supplied yet). Semester, Section, Day and Start Time are required; a ' +
      'module (Module Code or Module Title) and a teacher (Teacher ID or ' +
      'Lecturer) must also be present per row.',
  },
};

export function requiredColumns(kind: string): string[] {
  const contract = TEMPLATE_CONTRACTS[kind];
  if (!contract) return [];
  return contract.required;
}