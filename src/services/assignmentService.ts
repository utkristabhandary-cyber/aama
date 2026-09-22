import { TeacherAssignment, Teacher } from '../types';
import { ApiTeacherAssignment } from '../types/api';
import { apiClient, errorMessage } from './apiClient';
import { teacherService } from './teacherService';

const ASSIGNMENTS_URL = '/academics/assignments';

export const assignmentService = {
  async getAssignments(): Promise<TeacherAssignment[]> {
    const data = await apiClient.list<ApiTeacherAssignment>(ASSIGNMENTS_URL);
    return data.map(toViewModel);
  },

  async createAssignment(data: Omit<TeacherAssignment, 'id' | 'createdAt'>): Promise<TeacherAssignment> {
    const payload = {
      teacher: Number(data.teacherId),
      semester: Number(data.semesterId),
      section: Number(data.sectionId),
      subject: Number(data.subjectId),
      status: data.status,
    };
    try {
      const created = await apiClient.post<ApiTeacherAssignment>(ASSIGNMENTS_URL, payload);
      return toViewModel(created);
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  },

  async deleteAssignment(id: string): Promise<void> {
    await apiClient.delete(`${ASSIGNMENTS_URL}/${id}/`);
  },

  // Returns teachers assigned to teach this particular subject & section
  async getAssignedTeachersForClass(semesterId: string, sectionId: string, subjectId: string): Promise<Teacher[]> {
    const [assignments, teachers] = await Promise.all([
      this.getAssignments(),
      teacherService.getTeachers(),
    ]);
    const activeIds = assignments
      .filter(a =>
        a.semesterId === semesterId &&
        a.sectionId === sectionId &&
        a.subjectId === subjectId &&
        a.status === 'active'
      )
      .map(a => a.teacherId);
    return teachers.filter(t => activeIds.includes(t.id));
  },
};

function toViewModel(a: ApiTeacherAssignment): TeacherAssignment {
  return {
    id: String(a.id),
    teacherId: String(a.teacher),
    semesterId: String(a.semester),
    sectionId: String(a.section),
    subjectId: String(a.subject),
    status: a.status,
    createdAt: a.created_at,
  };
}