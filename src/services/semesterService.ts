import { Semester, SemesterStatus } from '../types';
import { ApiSemester, ApiSemesterCreate } from '../types/api';
import { apiClient } from './apiClient';

function toViewModel(api: ApiSemester): Semester {
  return {
    id: String(api.id),
    name: api.name,
    code: api.code,
    academicYear: api.academic_year,
    startDate: api.start_date,
    endDate: api.end_date,
    status: api.status as SemesterStatus,
    description: api.description || undefined,
  };
}

function toApi(data: Omit<Semester, 'id'>): ApiSemesterCreate {
  return {
    name: data.name,
    code: data.code,
    academic_year: data.academicYear,
    start_date: data.startDate,
    end_date: data.endDate,
    status: data.status,
    description: data.description || '',
  };
}

export const semesterService = {
  async getSemesters(): Promise<Semester[]> {
    const list = await apiClient.list<ApiSemester>('/academics/semesters/');
    return list.map(toViewModel);
  },

  async getSemesterById(id: string): Promise<Semester | undefined> {
    const data = await apiClient.get<ApiSemester>(`/academics/semesters/${id}/`);
    return toViewModel(data);
  },

  async createSemester(data: Omit<Semester, 'id'>): Promise<Semester> {
    const created = await apiClient.post<ApiSemester>('/academics/semesters/', toApi(data));
    return toViewModel(created);
  },

  async updateSemester(id: string, data: Partial<Semester>): Promise<Semester> {
    const updated = await apiClient.patch<ApiSemester>(`/academics/semesters/${id}/`, toApi(data as Omit<Semester, 'id'>));
    return toViewModel(updated);
  },

  async deleteSemester(id: string): Promise<void> {
    await apiClient.delete(`/academics/semesters/${id}/`);
  },
};
