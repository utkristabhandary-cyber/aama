import { Student, StudentStatus, TimetableSlot, DayOfWeek } from '../types';
import { ApiStudent, ApiStudentCreate, ApiMyAttendance, ApiTimetableSlot } from '../types/api';
import { apiClient } from './apiClient';

function toViewModel(api: ApiStudent): Student {
  return {
    id: String(api.id),
    studentId: api.student_id,
    rollNo: api.roll_no,
    name: api.name,
    email: api.email,
    phone: api.phone,
    semesterId: String(api.semester),
    sectionId: String(api.section),
    avatar: api.avatar,
    admissionYear: api.admission_year,
    status: api.status as StudentStatus,
    dateOfBirth: api.dob || undefined,
    address: api.address || undefined,
    guardianName: api.guardian_name || undefined,
    guardianPhone: api.guardian_phone || undefined,
    sectionName: api.section_name,
  };
}

function toApi(data: Omit<Student, 'id'>): ApiStudentCreate {
  return {
    student_id: data.studentId,
    roll_no: data.rollNo,
    name: data.name,
    email: data.email,
    phone: data.phone || '',
    section: Number(data.sectionId),
    semester: Number(data.semesterId),
    avatar: data.avatar || '',
    admission_year: data.admissionYear,
    dob: data.dateOfBirth || null,
    address: data.address || '',
    guardian_name: data.guardianName || '',
    guardian_phone: data.guardianPhone || '',
    status: data.status,
  };
}

export const studentService = {
  async getStudents(filters?: { semesterId?: string; sectionId?: string; status?: string; search?: string }): Promise<Student[]> {
    const list = await apiClient.list<ApiStudent>('/students/', {
      ...(filters?.semesterId ? { semester: filters.semesterId } : {}),
      ...(filters?.sectionId ? { section: filters.sectionId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.search ? { search: filters.search } : {}),
    });
    return list.map(toViewModel);
  },

  async getStudentById(id: string): Promise<Student | undefined> {
    const data = await apiClient.get<ApiStudent>(`/students/${id}/`);
    return toViewModel(data);
  },

  async createStudent(data: Omit<Student, 'id'>): Promise<Student> {
    const created = await apiClient.post<ApiStudent>('/students/', toApi(data));
    return toViewModel(created);
  },

  async updateStudent(id: string, data: Partial<Student>): Promise<Student> {
    const updated = await apiClient.patch<ApiStudent>(`/students/${id}/`, toApi(data as Omit<Student, 'id'>));
    return toViewModel(updated);
  },

  async deleteStudent(id: string): Promise<void> {
    await apiClient.delete(`/students/${id}/`);
  },

  /**
   * PATCH only the student's section (or clear it with `null`) without the
   * full-object `toApi` write of `updateStudent` — avoids blanking cohort
   * data. The backend derives `semester` from the section server-side.
   */
  async updateSectionAssignment(id: string, sectionId: string | null): Promise<Student> {
    const updated = await apiClient.patch<ApiStudent>(`/students/${id}/`, {
      section: sectionId ? Number(sectionId) : null,
    });
    return toViewModel(updated);
  },

  /**
   * Resolve the currently logged-in student from the authoritative `/me`
   * endpoint (returns 404 with no linked student profile).
   */
  async getCurrentStudent(_user?: { id?: string; studentId?: string; email?: string }): Promise<Student | undefined> {
    try {
      const data = await apiClient.get<ApiStudent>('/students/me/');
      return toViewModel(data);
    } catch {
      return undefined;
    }
  },

  /**
   * The authenticated student's own attendance summary, straight from the
   * server-side `/attendance/records/my/` aggregation.
   */
  async getMyAttendance(_studentId: string, filters?: { semesterId?: string; subjectId?: string }): Promise<ApiMyAttendance> {
    return apiClient.get<ApiMyAttendance>('/attendance/records/my/', {
      ...(filters?.semesterId ? { semester: filters.semesterId } : {}),
      ...(filters?.subjectId ? { subject: filters.subjectId } : {}),
    });
  },

  /**
   * The authenticated student's section timetable, read from the backend
   * `/academics/timetable/` endpoint filtered by the student's section.
   */
  async getMyTimetable(_studentId: string, sectionId?: string): Promise<TimetableSlot[]> {
    const slots = await apiClient.list<ApiTimetableSlot>('/academics/timetable/', {
      ...(sectionId ? { section: sectionId } : {}),
    });
    return slots.map(slot => ({
      id: String(slot.id),
      semesterId: String(slot.semester),
      sectionId: String(slot.section),
      sectionIds: (slot.section_ids || []).map(String),
      subjectId: String(slot.subject),
      teacherId: String(slot.teacher),
      day: slot.day as DayOfWeek,
      startTime: slot.start_time ? slot.start_time.slice(0, 5) : slot.start_time,
      endTime: slot.end_time ? slot.end_time.slice(0, 5) : slot.end_time,
      room: slot.room || '',
      classType: slot.class_type,
      notes: slot.notes || undefined,
      isCombined: !!slot.is_combined,
      subjectCode: slot.subject_code,
      subjectName: slot.subject_name,
      teacherName: slot.teacher_name,
      sectionName: slot.section_name,
      sectionNames: slot.section_names || [],
    }));
  },
};
