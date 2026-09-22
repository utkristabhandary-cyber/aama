import { Teacher, TeacherStatus, TimetableSlot, DayOfWeek } from '../types';
import {
  ApiTeacher,
  ApiTeacherCreate,
  ApiTeachingSession,
  ApiTeacherStudent,
  ApiClassReport,
  ApiTimetableSlot,
} from '../types/api';
import { apiClient } from './apiClient';
import { semesterService } from './semesterService';
import { sectionService } from './sectionService';
import { subjectService } from './subjectService';
import { studentService } from './studentService';
import { assignmentService } from './assignmentService';

function toViewModel(api: ApiTeacher): Teacher {
  const teacher: Teacher = {
    id: String(api.id),
    teacherId: api.teacher_id,
    name: api.name,
    email: api.email,
    phone: api.phone,
    department: api.department,
    designation: api.designation,
    qualification: api.qualification,
    avatar: api.avatar,
    status: api.status as TeacherStatus,
  };
  return teacher;
}

function toApi(data: Omit<Teacher, 'id'>): ApiTeacherCreate {
  return {
    teacher_id: data.teacherId,
    name: data.name,
    email: data.email,
    phone: data.phone,
    department: data.department,
    designation: data.designation,
    qualification: data.qualification,
    avatar: data.avatar || '',
    status: data.status,
  };
}

export interface TeacherClassItem {
  id: string;
  isCombined: boolean;
  subjectId: string;
  semesterId: string;
  sectionIds: string[];
  subject: { id: string; code: string; name: string; type?: string };
  semester?: { id: string; name: string; code: string };
  sectionLabels: string;
  day?: string;
  session: {
    classType?: string;
    room?: string;
    startTime?: string;
    endTime?: string;
  };
  totalStudents: number;
  students: any[];
}

export const teacherService = {
  async getTeachers(): Promise<Teacher[]> {
    const list = await apiClient.list<ApiTeacher>('/teachers/');
    return list.map(toViewModel);
  },

  async getTeacherById(id: string): Promise<Teacher | undefined> {
    const data = await apiClient.get<ApiTeacher>(`/teachers/${id}/`);
    return toViewModel(data);
  },

  async createTeacher(data: Omit<Teacher, 'id'>): Promise<Teacher> {
    const created = await apiClient.post<ApiTeacher>('/teachers/', toApi(data));
    return toViewModel(created);
  },

  async updateTeacher(id: string, data: Partial<Teacher>): Promise<Teacher> {
    const updated = await apiClient.patch<ApiTeacher>(`/teachers/${id}/`, toApi(data as Omit<Teacher, 'id'>));
    return toViewModel(updated);
  },

  async deleteTeacher(id: string): Promise<void> {
    await apiClient.delete(`/teachers/${id}/`);
  },

  /**
   * Resolve the currently logged-in teacher from the authoritative `/me`
   * endpoint (returns 404 with no linked teacher profile).
   */
  async getCurrentTeacher(_user?: { id?: string; teacherId?: string; email?: string }): Promise<Teacher | undefined> {
    try {
      const data = await apiClient.get<ApiTeacher>('/teachers/me/');
      return toViewModel(data);
    } catch {
      return undefined;
    }
  },

  /**
   * Aggregated teaching classes for the current teacher, built from the
   * teacher-scoped assignments + teaching-sessions + roster. Each item matches
   * the TeacherClassesView contract (subject/semester/sectionLabels/session/
   * totalStudents/students).
   */
  async getTeacherClasses(teacherId: string): Promise<TeacherClassItem[]> {
    const [assignments, sections, subjects, semesters, sessions, allStudents] =
      await Promise.all([
        assignmentService.getAssignments(),
        sectionService.getSections(),
        subjectService.getSubjects(),
        semesterService.getSemesters(),
        apiClient.list<ApiTeachingSession>('/academics/teaching-sessions/'),
        studentService.getStudents(),
      ]);

    const sectionById = new Map(sections.map(s => [s.id, s]));
    const subjectById = new Map(subjects.map(s => [s.id, s]));
    const semesterById = new Map(semesters.map(s => [s.id, s]));
    const sessionById = new Map(sessions.map(s => [String(s.id), s]));

    // Roster per section assigned to this teacher.
    const studentsBySection = new Map<string, any[]>();
    for (const stu of allStudents) {
      const key = stu.sectionId;
      const arr = studentsBySection.get(key) || [];
      arr.push(stu);
      studentsBySection.set(key, arr);
    }

    return assignments.map(assignmentItem => {
      const subject = subjectById.get(assignmentItem.subjectId);
      const semester = semesterById.get(assignmentItem.semesterId);
      const section = sectionById.get(assignmentItem.sectionId);

      // Prefer a teaching session that covers this assignment's section.
      const sessionForSection = sessions.find(ts => ts.section_ids.includes(Number(assignmentItem.sectionId)));
      const ts = sessionForSection ? sessionForSection : (sessionById.get(assignmentItem.id) ?? sessionForSection);

      const sectionLabels: string[] = [];
      if (ts && ts.section_ids?.length) {
        for (const sid of ts.section_ids) {
          const sec = sectionById.get(String(sid));
          if (sec) sectionLabels.push(sec.name.replace(/^Section\s+/i, ''));
        }
      }

      const sessionId = ts ? String(ts.id) : assignmentItem.id;
      const students = studentsBySection.get(assignmentItem.sectionId) || [];

      return {
        id: sessionId,
        isCombined: !!(ts && ts.is_combined) || sectionLabels.length > 1,
        subjectId: String(assignmentItem.subjectId),
        semesterId: String(assignmentItem.semesterId),
        sectionIds: ts && ts.section_ids?.length ? ts.section_ids.map(String) : [String(assignmentItem.sectionId)],
        subject: subject
          ? { id: subject.id, code: subject.code, name: subject.name, type: subject.type }
          : { id: assignmentItem.subjectId, code: '', name: '', type: undefined },
        semester: semester ? { id: semester.id, name: semester.name, code: semester.code } : undefined,
        sectionLabels: sectionLabels.length ? sectionLabels.join(' + ') : (section?.name.replace(/^Section\s+/i, '') ?? ''),
        day: ts?.day,
        session: {
          classType: ts?.class_type || subject?.type,
          room: ts?.room,
          startTime: ts ? toTime(ts.start_time) : undefined,
          endTime: ts ? toTime(ts.end_time) : undefined,
        },
        totalStudents: students.length,
        students,
      };
    });
  },

  /**
   * The authenticated teacher's own timetable slots. The backend scopes
   * `/academics/timetable/` to the requesting teacher server-side, so no
   * client-side `?teacher=` filter is needed (and would be ignored anyway).
   */
  async getTeacherTimetable(_teacherId: string): Promise<TimetableSlot[]> {
    const slots = await apiClient.list<ApiTimetableSlot>('/academics/timetable/');
    return slots.map(slot => ({
      id: String(slot.id),
      semesterId: String(slot.semester),
      sectionId: String(slot.section),
      sectionIds: (slot.section_ids || []).map(String),
      subjectId: String(slot.subject),
      teacherId: String(slot.teacher),
      day: slot.day as DayOfWeek,
      startTime: toTime(slot.start_time),
      endTime: toTime(slot.end_time),
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

  /**
   * The authenticated teacher's own enrolled-student roster with per-student
   * attendance summaries, served by `/teachers/students/`. The backend scopes
   * the roster to the teacher's active assignment sections server-side.
   */
  async getTeacherStudents(_teacherId: string): Promise<
    {
      id: string;
      studentId: string;
      rollNo: string;
      name: string;
      email: string;
      phone: string;
      avatar: string;
      sectionName: string;
      semesterName: string;
      attendanceSummary: ApiTeacherStudent['attendance_summary'];
    }[]
  > {
    const list = await apiClient.list<ApiTeacherStudent>('/teachers/students/');
    return list.map(student => ({
      id: String(student.id),
      studentId: student.student_id,
      rollNo: student.roll_no,
      name: student.name,
      email: student.email,
      phone: student.phone,
      avatar: student.avatar,
      sectionName: student.section_name,
      semesterName: student.semester_name,
      attendanceSummary: student.attendance_summary,
    }));
  },

  /**
   * Per-class attendance reports for the authenticated teacher, served by
   * `/teachers/reports/`. Already camelCased by the backend contract; returned
   * as the typed `ApiClassReport` list.
   */
  async getTeacherReports(_teacherId: string): Promise<ApiClassReport[]> {
    return apiClient.list<ApiClassReport>('/teachers/reports/');
  },
};

function toTime(value: string): string {
  return value ? value.slice(0, 5) : value;
}
