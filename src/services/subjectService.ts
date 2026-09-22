import { Subject, SubjectStatus, SubjectType } from '../types';
import { ApiSubject, ApiSubjectCreate } from '../types/api';
import { apiClient } from './apiClient';

function toViewModel(api: ApiSubject): Subject {
  return {
    id: String(api.id),
    code: api.code,
    name: api.name,
    semesterId: String(api.semester),
    credits: api.credits,
    type: api.type as SubjectType,
    status: api.status as SubjectStatus,
  };
}

function toApi(data: Omit<Subject, 'id'>): ApiSubjectCreate {
  return {
    code: data.code,
    name: data.name,
    semester: Number(data.semesterId),
    credits: data.credits,
    type: data.type,
    status: data.status,
  };
}

export const subjectService = {
  async getSubjects(semesterId?: string): Promise<Subject[]> {
    const list = await apiClient.list<ApiSubject>('/academics/subjects/', {
      ...(semesterId ? { semester: semesterId } : {}),
    });
    return list.map(toViewModel);
  },

  async getSubjectById(id: string): Promise<Subject | undefined> {
    const data = await apiClient.get<ApiSubject>(`/academics/subjects/${id}/`);
    return toViewModel(data);
  },

  async createSubject(data: Omit<Subject, 'id'>): Promise<Subject> {
    const created = await apiClient.post<ApiSubject>('/academics/subjects/', toApi(data));
    return toViewModel(created);
  },

  async updateSubject(id: string, data: Partial<Subject>): Promise<Subject> {
    const updated = await apiClient.patch<ApiSubject>(`/academics/subjects/${id}/`, toApi(data as Omit<Subject, 'id'>));
    return toViewModel(updated);
  },

  async deleteSubject(id: string): Promise<void> {
    await apiClient.delete(`/academics/subjects/${id}/`);
  },
};
