/** Backend (Django REST Framework) contract types.
 *
 * These mirror the DRF serializers exactly (snake_case field names, integer
 * primary keys). They are the I/O boundary of the API service layer and are
 * intentionally separate from the camelCase frontend view models in
 * `./index.ts`. The service layer is responsible for translating between the
 * two so the React tree keeps using its existing UI types.
 */

// ---------------------------------------------------------------------------
// Academics
// ---------------------------------------------------------------------------

export type ApiSemesterStatus = 'active' | 'upcoming' | 'completed';
export type ApiSubjectType = 'Lecture' | 'Tutorial' | 'Practical';
export type ApiSubjectStatus = 'active' | 'inactive';

export interface ApiSemester {
  id: number;
  name: string;
  code: string;
  academic_year: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  status: ApiSemesterStatus;
  description: string;
}

export type ApiSemesterCreate = Omit<ApiSemester, 'id'>;

export interface ApiSection {
  id: number;
  name: string;
  semester: number; // semester id
  capacity: number;
  room: string;
  semester_code?: string; // included by SectionDetailSerializer
}

export type ApiSectionCreate = Omit<ApiSection, 'id' | 'semester_code'>;

export interface ApiSubject {
  id: number;
  code: string;
  name: string;
  semester: number; // semester id
  credits: number;
  type: ApiSubjectType;
  status: ApiSubjectStatus;
}

export type ApiSubjectCreate = Omit<ApiSubject, 'id'>;

export interface ApiTeacherAssignment {
  id: number;
  teacher: number;
  semester: number;
  section: number;
  subject: number;
  status: 'active' | 'inactive';
  created_at: string;
}

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

export type ApiTeacherStatus = 'active' | 'inactive';

export interface ApiTeacher {
  id: number;
  teacher_id: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  qualification: string;
  avatar: string;
  status: ApiTeacherStatus;
}

export type ApiTeacherCreate = Omit<ApiTeacher, 'id'>;

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export type ApiStudentStatus = 'active' | 'graduated' | 'inactive';

export interface ApiStudent {
  id: number;
  student_id: string;
  roll_no: string;
  name: string;
  email: string;
  phone: string;
  section: number; // section id
  section_name: string;
  semester: number; // semester id
  semester_code: string;
  avatar: string;
  admission_year: number;
  dob: string | null;
  address: string;
  guardian_name: string;
  guardian_phone: string;
  status: ApiStudentStatus;
}

export type ApiStudentCreate = Omit<ApiStudent, 'id' | 'section_name' | 'semester_code'>;

// ---------------------------------------------------------------------------
// Timetable / Teaching sessions (academics)
// ---------------------------------------------------------------------------

export interface ApiTimetableSlot {
  id: number;
  semester: number;
  section: number;
  section_ids: number[];
  subject: number;
  teacher: number;
  day: string; // e.g. "Monday"
  start_time: string; // HH:mm:ss
  end_time: string; // HH:mm:ss
  room: string;
  class_type: ApiSubjectType;
  notes: string;
  is_combined: boolean;
  // Read-only display names so clients never need secondary lookups.
  subject_code: string;
  subject_name: string;
  teacher_name: string;
  section_name: string;
  section_names: string[]; // all participating sections for combined lectures
}

/** Write payload for creating a timetable slot. */
export interface ApiTimetableSlotCreate {
  semester: number;
  section: number;
  section_ids: number[];
  subject: number;
  teacher: number;
  day: string;
  start_time: string;
  end_time: string;
  room: string;
  class_type: ApiSubjectType;
  notes: string;
}

/** Partial update payload for a timetable slot. */
export type ApiTimetableSlotUpdate = Partial<ApiTimetableSlotCreate>;

export interface ApiTeachingSession {
  id: number;
  semester: number;
  subject: number;
  teacher: number;
  class_type: ApiSubjectType;
  section_ids: number[];
  is_combined: boolean;
  day: string;
  start_time: string;
  end_time: string;
  room: string;
  notes: string;
}

export type ApiHolidayType = 'institutional' | 'national' | 'festival' | 'restricted' | 'emergency';

export interface ApiHoliday {
  id: number;
  date: string; // YYYY-MM-DD
  title: string;
  description: string;
  type: ApiHolidayType;
}

// ---------------------------------------------------------------------------
// Timetable .xlsx import (admin staging screens)
// ---------------------------------------------------------------------------

export type ApiTimetableImportStatus = 'pending' | 'confirmed';
export type ApiTimetableImportIssueLevel = 'info' | 'warning' | 'error';
export type ApiTimetableImportPlan = 'new' | 'update' | 'duplicate' | 'unchanged' | 'error';
export type ApiTimetableImportRowStatus =
  | 'valid'
  | 'warning'
  | 'error'
  | 'duplicate'
  | 'unchanged'
  | 'update';

export interface ApiTimetableImportIssue {
  level: ApiTimetableImportIssueLevel;
  code: string;
  message: string;
}

export interface ApiTimetableImportEntityRef {
  id: number;
  name: string;
}

/** Teacher resolution result (Phase E): the authoritative identity is Teacher.teacher_id. */
export interface ApiTimetableImportTeacherRef extends ApiTimetableImportEntityRef {
  /** Institutional Teacher.teacher_id on the AAMS record that was matched. */
  teacher_id: string;
  /** How the teacher was matched: by institutional ID, or by normalized name. */
  match_method: 'id' | 'name';
  /** Raw teacher-id value supplied in the workbook (may be blank). */
  supplied_id: string;
  /** Raw lecturer/teacher-name value supplied in the workbook (may be blank). */
  supplied_name: string;
}

export interface ApiTimetableImportSemesterRef {
  id: number;
  code: string;
  name: string;
}

export interface ApiTimetableImportSubjectRef {
  id: number;
  code: string;
  name: string;
}

/** Normalized server row plus its plan/status classification (from plan_rows). */
export interface ApiTimetableImportRow {
  row: number; // real worksheet row number (1-based)
  raw: Record<string, string>;
  semester_label: string;
  module_code: string;
  module_title: string;
  lecturer: string;
  /** Raw Teacher ID column value from the workbook (authoritative when present). */
  teacher_id: string;
  section_raw: string;
  course: string;
  room: string;
  block: string;
  day: string;
  start_time: string; // HH:mm:ss or ''
  end_time: string; // HH:mm:ss or ''
  hours_minutes: number | null;
  class_type: string;
  sections_expanded?: string[]; // absent when section expansion failed
  is_combined?: boolean; // absent when section expansion failed
  semester: ApiTimetableImportSemesterRef | null;
  sections?: ApiTimetableImportEntityRef[]; // absent when nothing matched
  subject: ApiTimetableImportSubjectRef | null;
  teacher: ApiTimetableImportTeacherRef | null;
  plan: ApiTimetableImportPlan;
  status: ApiTimetableImportRowStatus;
  issues: ApiTimetableImportIssue[];
}

export interface ApiTimetableImportCounts {
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  duplicate_rows: number;
  unchanged_rows: number;
  new_rows: number;
  updated_rows: number;
  combined_rows: number;
  conflict_rows: number;
  commit_rows: number;
  /** Confirm-only extras (POST /confirm/ response). */
  created_rows?: number;
}

export interface ApiTimetableImportUnresolved {
  semesters: string[];
  sections: string[];
  subjects: string[];
  teachers: string[];
}

export interface ApiTimetableImportSummary {
  counts: ApiTimetableImportCounts;
  unresolved: ApiTimetableImportUnresolved;
}

export interface ApiTimetableImportPreview {
  session_uuid: string;
  file: { sheet_name: string; sheet_count: number };
  summary: ApiTimetableImportSummary;
  rows: ApiTimetableImportRow[];
}

export interface ApiTimetableImportConfirm {
  session_uuid: string;
  summary: ApiTimetableImportSummary;
  rows: ApiTimetableImportRow[];
}

export interface ApiTimetableImportSession {
  uuid: string;
  file_name: string;
  file_size: number;
  sheet_name: string;
  sheet_count: number;
  total_rows: number;
  status: ApiTimetableImportStatus;
  created_at: string;
  confirmed_at: string | null;
  summary: ApiTimetableImportSummary;
}

// ---------------------------------------------------------------------------
// Reports (teacher/admin scoped summaries)
// ---------------------------------------------------------------------------

export interface ApiAtRiskStudent {
  studentId: number;
  name: string;
  rollNo: string;
  section: string | null;
  marked: number;
  present: number;
  late: number;
  absent: number;
  percentage: number;
}

export interface ApiNotification {
  id: number;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string;
}

export interface ApiReportSummary {
  semester: string | null;
  generatedAt: string;
  totalAttendanceSessions: number;
  totalMarked: number;
  present: number;
  late: number;
  absent: number;
  attendancePercentage: number;
  totalStudents: number;
  studentsAtRisk: ApiAtRiskStudent[];
}

/**
 * Institution-wide analytics for the admin-only surfaces, served by
 * `GET /reports/admin/` (admin role only; teachers are blocked). This single
 * payload drives both the admin dashboard and the admin reports view so they
 * never fall back to local mock numbers.
 */
export interface ApiAdminAnalytics {
  semester: string | null;
  generatedAt: string;
  counts: {
    totalStudents: number;
    totalTeachers: number;
    totalSemesters: number;
    activeSemesters: number;
    totalSections: number;
    totalSubjects: number;
  };
  attendance: {
    totalAttendanceSessions: number;
    totalMarked: number;
    present: number;
    late: number;
    absent: number;
    attendancePercentage: number;
  };
  studentsAtRisk: ApiAtRiskStudent[];
  bySubject: {
    subjectId: number;
    subjectCode: string;
    subjectName: string;
    semesterId: number;
    semesterName: string;
    credits: number;
    sessions: number;
    marked: number;
    present: number;
    late: number;
    absent: number;
    percentage: number;
  }[];
  bySection: {
    sectionId: number;
    sectionName: string;
    semesterName: string;
    sessions: number;
    studentCount: number;
    marked: number;
    present: number;
    late: number;
    absent: number;
    percentage: number;
  }[];
  studentRoster: {
    studentId: number;
    studentCode: string;
    rollNo: string;
    name: string;
    sectionId: number | null;
    sectionName: string | null;
    semesterId: number | null;
    semesterName: string | null;
    guardianName: string;
    guardianPhone: string;
    marked: number;
    present: number;
    late: number;
    absent: number;
    percentage: number | null;
  }[];
}

// ---------------------------------------------------------------------------
// Attendance (student self-endpoint / auth me)
// ---------------------------------------------------------------------------

export interface ApiMyAttendance {
  student: {
    id: number;
    student_id: string;
    name: string;
    roll_no: string;
  };
  overallPercentage: number;
  overallPresent: number;
  overallTotal: number;
  overallAbsent: number;
  overallLate: number;
  totalClasses: number;
  totalPresent: number;
  totalAbsent: number;
  totalLate: number;
  examEligibility: 'eligible' | 'shortage';
  subjects: {
    subjectId: number;
    subjectCode: string;
    subjectName: string;
    present: number;
    absent: number;
    late: number;
    total: number;
    percentage: number;
  }[];
  logs: {
    attendanceSessionId: number;
    sessionDate: string;
    startTime: string | null;
    endTime: string | null;
    classType: string;
    subjectId: number;
    subjectCode: string;
    subjectName: string;
    teacherName: string;
    status: string;
    notes?: string;
  }[];
}

// ---------------------------------------------------------------------------
// Teacher operational endpoints (/teachers/students/, /teachers/reports/)
// ---------------------------------------------------------------------------

export interface ApiAttendanceSummary {
  marked: number;
  present: number; // present + late
  absent: number;
  late: number;
  percentage: number;
}

export interface ApiTeacherStudent {
  id: number;
  student_id: string;
  roll_no: string;
  name: string;
  email: string;
  phone: string;
  avatar: string;
  section_name: string;
  semester_name: string;
  semester_code: string;
  attendance_summary: ApiAttendanceSummary;
}

export interface ApiClassReportStudent {
  studentId: number;
  name: string;
  rollNo: string;
  studentCode: string;
  sectionName: string;
  attendedSessions: number;
  totalSessions: number;
  percentage: number;
  status: 'Clear' | 'Shortage';
}

export interface ApiClassReport {
  classId: number;
  subject: {
    id: number;
    code: string;
    name: string;
  };
  classType: string;
  semester: {
    id: number;
    name: string;
    code: string;
  };
  sections: { id: number; name: string }[];
  isCombined: boolean;
  sessionCount: number;
  averagePercentage: number;
  studentMetrics: ApiClassReportStudent[];
}

// ---------------------------------------------------------------------------
// DRF error helpers
// ---------------------------------------------------------------------------

export interface ApiErrorPayload {
  detail?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Attendance sessions & records (Phase 5 session engine)
// ---------------------------------------------------------------------------

export type ApiAttendancePhase = 'manual' | 'qr';
export type ApiAttendanceStatus = 'present' | 'absent' | 'late';

export interface ApiAttendanceRecordStudent {
  id: number;
  student_id: string;
  roll_no: string;
  name: string;
}

export interface ApiAttendanceRecord {
  id: number;
  student: ApiAttendanceRecordStudent;
  status: ApiAttendanceStatus;
  marking: boolean;
  marking_complete: boolean;
  submitted_at: string | null;
}

export interface ApiAttendanceSession {
  id: number;
  session_date: string;
  subject: number;
  subject_code: string;
  subject_name: string;
  teacher: number;
  teacher_name: string;
  phase: ApiAttendancePhase;
  start_time: string;
  planned_end_time: string;
  end_time: string | null;
  section_ids: number[];
  sections: number[];
  section_names: string[];
  is_combined: boolean;
  is_finalized: boolean;
  semester_id: number;
  semester_name: string;
  teaching_session: number | null;
  attendance_ids: number[];
  marked_ids: number[];
  late_reason: string;
  is_auto_present: boolean;
  records: ApiAttendanceRecord[];
  submitted_at: string | null;
  created_at: string;
}

export type ApiAttendanceSessionCreate = {
  session_date: string;
  subject: number;
  phase: ApiAttendancePhase;
  start_time: string;
  planned_end_time: string;
  section_ids: number[];
  teaching_session?: number | null;
};

/** Roster row from `GET /attendance/sessions/{id}/roll/`. */
export interface ApiRollStudent {
  studentId: number;
  studentCode: string;
  studentName: string;
  rollNo: string;
  sectionId: number | null;
  sectionName: string | null;
  status: ApiAttendanceStatus | null;
  marked: boolean;
}

export interface ApiRollResponse {
  attendanceSessionId: number;
  students: ApiRollStudent[];
}

// ---------------------------------------------------------------------------
// QR attendance session & secure check-in
// ---------------------------------------------------------------------------

/**
 * How a check-in verified its environment. This application is web-only: a
 * browser cannot attest a classroom BSSID, so the client honestly reports
 * `unavailable` and the backend records only that value.
 */
export type ApiNetworkVerificationMethod = 'unavailable';

/** Serializer contract for `QRAttendanceSessionSerializer`. */
export interface ApiQRAttendanceSession {
  id: number;
  teacher: number;
  attendance_session: number;
  token: string;
  token_generated_at: string;
  student_ids: number[];
  revoked: boolean;
  /** Full encoded payload the QR screen must display: `AAMSQR1|<id>|<TOKEN>`. */
  payload: string;
  checked_in_count: number;
  expires_in_seconds: number;
  created_at: string;
}

export interface ApiQRStartRequest {
  attendanceSessionId: number | string;
}

/** Body for `POST /attendance/qr/check-in/`. Network is always self-reported evidence. */
export interface ApiQRCheckInRequest {
  qrPayload: string;
  network?: {
    method: ApiNetworkVerificationMethod;
  };
}

export interface ApiQRCheckInAttendance {
  id: number;
  studentId: number;
  status: ApiAttendanceStatus;
  checkedInAt: string | null;
  networkVerificationMethod: ApiNetworkVerificationMethod;
}

export interface ApiQRCheckInResponse {
  detail: string;
  alreadyRecorded: boolean;
  status?: ApiAttendanceStatus;
  networkVerificationMethod?: ApiNetworkVerificationMethod;
  attendance?: ApiQRCheckInAttendance;
}

export interface ApiQRValidateResponse {
  valid: boolean;
  detail?: string;
  message?: string;
  payload?: {
    attendanceSessionId: number;
    teachingSessionId: number | null;
    subjectName: string;
    teacherName: string;
    phase: string;
  };
}

// ---------------------------------------------------------------------------
// Generic institutional imports (Phase A foundation; nothing exposed yet)
// ---------------------------------------------------------------------------

export type ApiImportKind = 'students' | 'teachers';

/** Strict engine severity ordering: VALID < WARNING < SUSPICIOUS < ERROR. */
export type ApiImportSeverity = 'valid' | 'warning' | 'suspicious' | 'error';

export type ApiImportRowStatus =
  | 'data'
  | 'partial'
  | 'duplicate_identical'
  | 'duplicate_conflicting'
  | 'update'
  | 'unchanged';

export interface ApiImportIssue {
  severity: ApiImportSeverity;
  code: string;
  message: string;
}

export interface ApiImportRow {
  /** Real worksheet row number (1-based). */
  row: number;
  /** Raw cell strings kept for review only (never written). */
  cells: Record<string, string>;
  /** Server-side normalized values keyed by column index. */
  normalized: Record<string, string>;
  issues: ApiImportIssue[];
  severity: ApiImportSeverity;
  status: ApiImportRowStatus;
  classification: string;
  identity: { keys: number[]; values: Record<string, string> } | null;
  db_match: unknown;
  plan: unknown;
}

export interface ApiImportCounts {
  total_rows: number;
  data_rows: number;
  valid_rows: number;
  warning_rows: number;
  suspicious_rows: number;
  error_rows: number;
  empty_rows: number;
  partial_rows: number;
  duplicate_rows: number;
  conflicting_rows: number;
}

// ---------------------------------------------------------------------------
// Phase D: account-consequence plan (per confirmed import row)
// ---------------------------------------------------------------------------

/** Server account-action vocabulary — mirrors provisioning ACTION_* constants. */
export type ApiImportAccountAction =
  | 'provision'
  | 'account_exists'
  | 'no_account'
  | 'account_conflict'
  | 'error';

/** Per-row account consequence (safe for review; never contains passwords). */
export interface ApiImportRowAccount {
  action: ApiImportAccountAction;
  username: string | null;
  role: 'student' | 'teacher' | null;
  must_change_password: boolean | null;
  message: string;
}

/** Rolled-up account consequences across a planned import. */
export interface ApiAccountPlanCounts {
  provision: number;
  account_exists: number;
  no_account: number;
  conflict: number;
}

export interface ApiImportColumns {
  total: number;
  blank: number;
  duplicates: number;
  identity: string[];
  unmapped: string[];
  empty_columns: string[];
}

export interface ApiImportSummary {
  kind: ApiImportKind;
  file: { sheet_name: string; sheet_count: number };
  counts: ApiImportCounts;
  columns: ApiImportColumns;
  /** True when ERROR-level rows/alerts would block confirmation (later phase). */
  block_confirmation: boolean;
  alerts: ApiImportIssue[];
}

export interface ApiImportPreview {
  session_uuid: string;
  kind: ApiImportKind;
  file: { name: string; size: number; sheet_name: string; sheet_count: number };
  summary: ApiImportSummary;
  rows: ApiImportRow[];
}

export interface ApiImportSession {
  kind: ApiImportKind;
  uuid: string;
  file_name: string;
  file_size: number;
  sheet_name: string;
  sheet_count: number;
  total_rows: number;
  status: 'pending' | 'confirmed';
  created_at: string;
  confirmed_at: string | null;
  summary: ApiImportSummary;
}

// ---------------------------------------------------------------------------
// Student institutional import (Phase B: preview + confirm + history)
// ---------------------------------------------------------------------------

/** Student import plan: what confirming this row would do. */
export type ApiStudentImportPlan = 'new' | 'update' | 'unchanged' | 'duplicate' | 'error';

export interface ApiStudentImportPlacement {
  /** Resolved semester (null when unresolved/blank). */
  semester: { id: number; code: string; name: string } | null;
  /** Resolved section name (null when unresolved/blank). */
  section: string | null;
  /** Program prefix token extracted from the Program/Sec cell (informational). */
  program_token: string | null;
  placement_change?: boolean;
}

export interface ApiStudentImportFieldChange {
  field: string;
  label: string;
  old: string;
  new: string;
}

/** A student import row: generic normalized row + student enrichment. */
export interface ApiStudentImportRow extends ApiImportRow {
  /** Normalized values indexed by mapped student column name (review only). */
  values: Record<string, string>;
  placement: ApiStudentImportPlacement | null;
  field_changes: ApiStudentImportFieldChange[];
  db_match: { id: number; matched_by: 'student_id' } | null;
  plan: ApiStudentImportPlan;
  classification: ApiStudentImportPlan;
  status: ApiImportRowStatus;
  /** Phase D account consequence (never contains a password). */
  account?: ApiImportRowAccount | null;
}

export interface ApiStudentImportPlanCounts {
  new: number;
  update: number;
  unchanged: number;
  duplicate: number;
  error: number;
}

export interface ApiStudentImportPlacementSummary {
  changed: number;
  blank: number;
  unresolved: number;
  program_tokens: string[];
}

export interface ApiStudentImportSummary extends ApiImportSummary {
  plans: ApiStudentImportPlanCounts;
  placement: ApiStudentImportPlacementSummary;
  /** Rolled-up Phase D account consequences. */
  accounts: ApiAccountPlanCounts;
}

export interface ApiStudentImportPreview {
  session_uuid: string;
  kind: 'students';
  file: { name: string; size: number; sheet_name: string; sheet_count: number };
  summary: ApiStudentImportSummary;
  rows: ApiStudentImportRow[];
}

export interface ApiStudentImportConfirmResult {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Phase D: how many login accounts were provisioned inside the commit. */
  accounts_provisioned: number;
}

export interface ApiStudentImportConfirm {
  session: ApiImportSession;
  result: ApiStudentImportConfirmResult;
}

// ---------------------------------------------------------------------------
// Teacher Import Types (Phase C)
// ---------------------------------------------------------------------------

export type ApiTeacherImportPlan = 'new' | 'update' | 'unchanged' | 'duplicate' | 'error';

export interface ApiTeacherImportFieldChange {
  field: string;
  label: string;
  old: string;
  new: string;
}

export interface ApiTeacherImportRow extends ApiImportRow {
  values: Record<string, string>;
  db_match: { id: number; matched_by: string } | null;
  field_changes: ApiTeacherImportFieldChange[];
  plan: ApiTeacherImportPlan;
  classification: ApiTeacherImportPlan;
  /** Phase D account consequence (never contains a password). */
  account?: ApiImportRowAccount | null;
}

export interface ApiTeacherImportPlanCounts {
  new: number;
  update: number;
  unchanged: number;
  duplicate: number;
  error: number;
}

export interface ApiTeacherImportChangesSummary {
  rows_with_changes: number;
  change_fields: string[];
}

export interface ApiTeacherImportSummary extends ApiImportSummary {
  plans: ApiTeacherImportPlanCounts;
  changes: ApiTeacherImportChangesSummary;
  /** Rolled-up Phase D account consequences. */
  accounts: ApiAccountPlanCounts;
}

export interface ApiTeacherImportPreview {
  session_uuid: string;
  kind: string;
  file: { name: string; size: number; sheet_name: string; sheet_count: number };
  summary: ApiTeacherImportSummary;
  rows: ApiTeacherImportRow[];
}

export interface ApiTeacherImportConfirmResult {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Phase D: how many login accounts were provisioned inside the commit. */
  accounts_provisioned: number;
}

export interface ApiTeacherImportConfirm {
  session: ApiImportSession;
  result: ApiTeacherImportConfirmResult;
}

// ---------------------------------------------------------------------------
// Teacher Timesheet (Phase I approval ledger)
// ---------------------------------------------------------------------------

export type ApiTimesheetEntryType = 'class' | 'duty' | 'other';
export type ApiTimesheetEntryStatus = 'draft' | 'submitted' | 'confirmed' | 'rejected';

/** Mirrors `TimesheetEntrySerializer` (contract in `backend/apps/timesheet/`). */
export interface ApiTimesheetEntry {
  id: number;
  teacher: number;
  teacher_name: string;
  entry_date: string; // YYYY-MM-DD
  type: ApiTimesheetEntryType;
  subject: number | null;
  subject_code: string;
  subject_name: string;
  section_ids: number[];
  sections: number[];
  section_names: string[];
  semester: number | null;
  semester_name: string;
  start_time: string; // HH:mm:ss
  end_time: string; // HH:mm:ss
  /** Server-computed duration (a client-supplied duration is never accepted). */
  duration_minutes: number;
  note: string;
  status: ApiTimesheetEntryStatus;
  rejection_reason: string;
  is_holiday: boolean;
  holiday_title: string;
  created_at: string;
  updated_at: string;
}

/** Write payload: `teacher` is only sent/persisted for admin creators. */
export interface ApiTimesheetEntryCreate {
  entry_date: string;
  type: ApiTimesheetEntryType;
  subject?: number | null;
  section_ids?: number[];
  start_time: string;
  end_time: string;
  note?: string;
  teacher?: number;
}

export type ApiTimesheetEntryUpdate = Partial<ApiTimesheetEntryCreate>;

/** Optional query filters shared by the entries list, summary, and export. */
export interface ApiTimesheetFilters {
  type?: string;
  status?: string;
  semester?: string;
  teacher?: string;
  date_from?: string;
  date_to?: string;
}

export interface ApiTimesheetPerTeacher {
  teacher: number;
  teacher_name: string;
  count: number;
  duration_minutes: number;
}

export interface ApiTimesheetDay {
  entry_date: string;
  duration_minutes: number;
}

/** `GET /api/timesheet/summary/` — CONFIRMED-only approval ledger. */
export interface ApiTimesheetSummary {
  count: number;
  duration_minutes: number;
  by_type: Partial<Record<ApiTimesheetEntryType, number>>;
  by_day: ApiTimesheetDay[];
  per_teacher: ApiTimesheetPerTeacher[];
}
