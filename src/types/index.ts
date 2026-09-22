export type Role = 'admin' | 'teacher' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  status: 'active' | 'inactive';
  role: Role;
  avatar?: string;
  teacherId?: string;
  studentId?: string;
  department?: string;
  semesterId?: string;
  sectionId?: string;
  /** True when the account still holds the provisional importer-generated password. */
  mustChangePassword?: boolean;
}

export type SemesterStatus = 'active' | 'upcoming' | 'completed';

export interface Semester {
  id: string;
  name: string;
  code: string; // e.g. "SEM1-2026"
  academicYear: string; // e.g. "2026-2027"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: SemesterStatus;
  description?: string;
}

export interface Section {
  id: string;
  name: string; // e.g. "Section A"
  semesterId: string;
  capacity: number;
  room: string;
}

export type SubjectType = 'Lecture' | 'Tutorial' | 'Practical';
export type SubjectStatus = 'active' | 'inactive';

export interface Subject {
  id: string;
  code: string; // e.g. "CS101"
  name: string; // e.g. "Programming Fundamentals"
  semesterId: string;
  credits: number;
  type: SubjectType;
  status: SubjectStatus;
}

export type TeacherStatus = 'active' | 'inactive';

export interface Teacher {
  id: string;
  teacherId: string; // e.g. "TCH-001"
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  qualification: string;
  avatar: string;
  status: TeacherStatus;
}

export type StudentStatus = 'active' | 'graduated' | 'inactive';

export interface Student {
  id: string;
  studentId: string; // e.g. "STU-2026-001"
  rollNo: string; // e.g. "01"
  name: string;
  email: string;
  phone: string;
  semesterId: string;
  sectionId: string;
  avatar: string;
  admissionYear: number;
  status: StudentStatus;
  dateOfBirth?: string;
  address?: string;
  guardianName?: string;
  guardianPhone?: string;
  sectionName?: string;
}

export interface TeacherAssignment {
  id: string;
  teacherId: string;
  semesterId: string;
  sectionId: string;
  subjectId: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export type DayOfWeek = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday';

export interface TimetableSlot {
  id: string;
  semesterId: string;
  sectionId: string; // Primary or default section
  sectionIds?: string[]; // All participating sections for combined classes (e.g. F1 + F2 + F3)
  subjectId: string;
  teacherId: string;
  day: DayOfWeek;
  startTime: string; // HH:mm e.g. "09:00"
  endTime: string; // HH:mm e.g. "10:00"
  room: string;
  classType: SubjectType; // 'Lecture' | 'Practical' | 'Tutorial'
  notes?: string;
  isCombined?: boolean;
  // Backend-provided display names (no secondary store lookups needed).
  subjectCode?: string;
  subjectName?: string;
  teacherName?: string;
  sectionName?: string;
  sectionNames?: string[];
}

/**
 * TeachingSession represents an assigned teaching block for faculty.
 * Explicitly supports combined lectures (e.g., Database Lecture F1 + F2 + F3)
 * as well as single section practicals and tutorials.
 */
export interface TeachingSession {
  id: string;
  semesterId: string;
  subjectId: string;
  teacherId: string;
  classType: SubjectType;
  sectionIds: string[]; // e.g. ['sec-1a', 'sec-1b']
  isCombined?: boolean;
  day?: DayOfWeek;
  startTime: string;
  endTime: string;
  room: string;
  notes?: string;
}

/**
 * Section Reallocation CSV types
 */
export type AllocationRowStatus = 'Change' | 'No Change' | 'Unallocated' | 'REJECTED';

export interface SectionAllocationRow {
  rowNumber: number;
  studentId: string; // Institutional ID, e.g. STU-2026-001 or ST001
  studentName: string;
  currentSectionName: string;
  newSectionName: string;
  status: AllocationRowStatus;
  reason?: string;
  resolvedStudentDbId?: string;
  resolvedSectionDbId?: string;
}

export interface SectionAllocationSummary {
  totalRows: number;
  validRows: number;
  changedCount: number;
  unchangedCount: number;
  unallocatedCount: number;
  rejectedCount: number;
}

export type AttendanceStatus = 'present' | 'absent' | 'late';

export interface AttendanceRecordItem {
  studentId: string;
  status: AttendanceStatus;
  notes?: string;
}

export interface AttendanceSession {
  id: string;
  timetableSlotId?: string;
  teachingSessionId?: string;
  semesterId: string;
  sectionId: string;
  sectionIds?: string[]; // Multiple sections for combined lectures
  isCombined?: boolean;
  subjectId: string;
  teacherId: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  room: string;
  records: Record<string, AttendanceStatus>; // studentId -> status
  notes?: string;
  submittedAt: string;
  status: 'submitted' | 'draft';
}

export type HolidayType = 'institutional' | 'national' | 'festival' | 'restricted' | 'emergency';

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  description: string;
  type: HolidayType;
}

export type NotificationType = 'info' | 'warning' | 'success' | 'alert' | 'danger';

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  timestamp: string;
  isRead: boolean;
  targetRole?: Role;
  link?: string;
  read?: boolean;
  createdAt?: string;
}

export type Notification = NotificationItem;

export interface StudentAttendanceSummary {
  studentId: string;
  totalClasses: number;
  present: number;
  absent: number;
  late: number;
  percentage: number;
  subjectBreakdown: {
    subjectId: string;
    subjectName: string;
    subjectCode: string;
    total: number;
    present: number;
    absent: number;
    late: number;
    percentage: number;
  }[];
}

export interface ReportFilter {
  semesterId?: string;
  sectionId?: string;
  subjectId?: string;
  teacherId?: string;
  startDate?: string;
  endDate?: string;
}
