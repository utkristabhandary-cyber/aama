import { apiClient } from './apiClient';
import {
  ApiTimetableSlot,
  ApiTimetableSlotCreate,
  ApiTimetableSlotUpdate,
  ApiTimetableImportConfirm,
  ApiTimetableImportPreview,
  ApiTimetableImportSession,
} from '../types/api';
import { TimetableSlot, DayOfWeek, SubjectType } from '../types';

// ---------------------------------------------------------------------------
// Translation helpers: frontend ↔ backend payload
// ---------------------------------------------------------------------------

function toFrontend(raw: ApiTimetableSlot): TimetableSlot {
  return {
    id: String(raw.id),
    semesterId: String(raw.semester),
    sectionId: String(raw.section),
    sectionIds: raw.section_ids ? raw.section_ids.map(String) : undefined,
    subjectId: String(raw.subject),
    teacherId: String(raw.teacher),
    day: raw.day as DayOfWeek,
    startTime: raw.start_time.slice(0, 5), // "09:00:00" → "09:00"
    endTime: raw.end_time.slice(0, 5),
    room: raw.room,
    classType: raw.class_type as SubjectType,
    notes: raw.notes || undefined,
    isCombined: raw.is_combined,
    subjectCode: raw.subject_code,
    subjectName: raw.subject_name,
    teacherName: raw.teacher_name,
    sectionName: raw.section_name,
    sectionNames: raw.section_names,
  };
}

function toBackendCreate(slot: {
  semesterId: string;
  sectionId: string;
  sectionIds?: string[];
  subjectId: string;
  teacherId: string;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
  classType: string;
  notes?: string;
}): ApiTimetableSlotCreate {
  return {
    semester: Number(slot.semesterId),
    section: Number(slot.sectionId),
    section_ids: (slot.sectionIds || []).map(Number),
    subject: Number(slot.subjectId),
    teacher: Number(slot.teacherId),
    day: slot.day,
    start_time: slot.startTime.length === 5 ? `${slot.startTime}:00` : slot.startTime,
    end_time: slot.endTime.length === 5 ? `${slot.endTime}:00` : slot.endTime,
    room: slot.room,
    class_type: slot.classType as ApiTimetableSlotCreate['class_type'],
    notes: slot.notes || '',
  };
}

function toBackendUpdate(slot: Partial<{
  semesterId: string;
  sectionId: string;
  sectionIds: string[];
  subjectId: string;
  teacherId: string;
  day: string;
  startTime: string;
  endTime: string;
  room: string;
  classType: string;
  notes: string;
}>): ApiTimetableSlotUpdate {
  const out: ApiTimetableSlotUpdate = {};
  if (slot.semesterId !== undefined) out.semester = Number(slot.semesterId);
  if (slot.sectionId !== undefined) out.section = Number(slot.sectionId);
  if (slot.sectionIds !== undefined) out.section_ids = slot.sectionIds.map(Number);
  if (slot.subjectId !== undefined) out.subject = Number(slot.subjectId);
  if (slot.teacherId !== undefined) out.teacher = Number(slot.teacherId);
  if (slot.day !== undefined) out.day = slot.day;
  if (slot.startTime !== undefined) out.start_time = slot.startTime.length === 5 ? `${slot.startTime}:00` : slot.startTime;
  if (slot.endTime !== undefined) out.end_time = slot.endTime.length === 5 ? `${slot.endTime}:00` : slot.endTime;
  if (slot.room !== undefined) out.room = slot.room;
  if (slot.classType !== undefined) out.class_type = slot.classType as ApiTimetableSlotUpdate['class_type'];
  if (slot.notes !== undefined) out.notes = slot.notes;
  return out;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export const timetableLiveApi = {
  /** Fetch timetable slots with optional backend filters. */
  async getTimetable(filters?: {
    semesterId?: string;
    sectionId?: string;
    teacherId?: string;
    day?: string;
  }): Promise<TimetableSlot[]> {
    const query: Record<string, string> = {};
    if (filters?.semesterId && filters.semesterId !== 'all') query.semester = filters.semesterId;
    if (filters?.sectionId && filters.sectionId !== 'all') query.section = filters.sectionId;
    if (filters?.teacherId && filters.teacherId !== 'all') query.teacher = filters.teacherId;
    if (filters?.day && filters.day !== 'all') query.day = filters.day;

    const raw = await apiClient.list<ApiTimetableSlot>('/academics/timetable/', query);
    return raw.map(toFrontend);
  },

  /** Create a new timetable slot. Throws on conflict or validation error. */
  async createSlot(slot: {
    semesterId: string;
    sectionId: string;
    sectionIds?: string[];
    subjectId: string;
    teacherId: string;
    day: string;
    startTime: string;
    endTime: string;
    room: string;
    classType: string;
    notes?: string;
  }): Promise<TimetableSlot> {
    const raw = await apiClient.post<ApiTimetableSlot>(
      '/academics/timetable/',
      toBackendCreate(slot),
    );
    return toFrontend(raw);
  },

  /** Partially update a timetable slot. Throws on conflict or validation error. */
  async updateSlot(
    id: string,
    slot: Partial<{
      semesterId: string;
      sectionId: string;
      sectionIds: string[];
      subjectId: string;
      teacherId: string;
      day: string;
      startTime: string;
      endTime: string;
      room: string;
      classType: string;
      notes: string;
    }>,
  ): Promise<TimetableSlot> {
    const raw = await apiClient.patch<ApiTimetableSlot>(
      `/academics/timetable/${id}/`,
      toBackendUpdate(slot),
    );
    return toFrontend(raw);
  },

  /** Delete a timetable slot. */
  async deleteSlot(id: string): Promise<void> {
    await apiClient.delete(`/academics/timetable/${id}/`);
  },

  // -----------------------------------------------------------------------
  // Import (live backend pipeline — the server is the single source of truth)
  // -----------------------------------------------------------------------

  /** Fetch the admin's own import session history. */
  async getImportHistory(): Promise<ApiTimetableImportSession[]> {
    return apiClient.list<ApiTimetableImportSession>('/academics/timetable-import/');
  },

  /**
   * Upload a .xlsx workbook and get the server-produced preview plan.
   * Throws ApiError with the backend's {detail, code} on structural file
   * problems (unsupported type, size, missing columns, unreadable workbook).
   */
  async previewImport(file: File): Promise<ApiTimetableImportPreview> {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post<ApiTimetableImportPreview>(
      '/academics/timetable-import/preview/',
      formData,
    );
  },

  /**
   * Commit a pending import session. The server re-validates and re-matches
   * every row against the current database and commits transactionally, so the
   * client only ever sends the session UUID.
   */
  async confirmImport(sessionUuid: string): Promise<ApiTimetableImportConfirm> {
    return apiClient.post<ApiTimetableImportConfirm>(
      '/academics/timetable-import/confirm/',
      { session_uuid: sessionUuid },
    );
  },
};
