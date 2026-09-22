import { Section } from '../types';
import { ApiSection, ApiSectionCreate } from '../types/api';
import { apiClient } from './apiClient';

function toViewModel(api: ApiSection): Section {
  return {
    id: String(api.id),
    name: api.name,
    semesterId: String(api.semester),
    capacity: api.capacity,
    room: api.room,
  };
}

function toApi(data: Omit<Section, 'id'>): ApiSectionCreate {
  return {
    name: data.name,
    semester: Number(data.semesterId),
    capacity: data.capacity,
    room: data.room,
  };
}

export const sectionService = {
  async getSections(semesterId?: string): Promise<Section[]> {
    const list = await apiClient.list<ApiSection>('/academics/sections/', {
      ...(semesterId ? { semester: semesterId } : {}),
    });
    return list.map(toViewModel);
  },

  async getSectionById(id: string): Promise<Section | undefined> {
    const data = await apiClient.get<ApiSection>(`/academics/sections/${id}/`);
    return toViewModel(data);
  },

  async createSection(data: Omit<Section, 'id'>): Promise<Section> {
    const created = await apiClient.post<ApiSection>('/academics/sections/', toApi(data));
    return toViewModel(created);
  },

  async updateSection(id: string, data: Partial<Section>): Promise<Section> {
    const updated = await apiClient.patch<ApiSection>(`/academics/sections/${id}/`, toApi(data as Omit<Section, 'id'>));
    return toViewModel(updated);
  },

  async deleteSection(id: string): Promise<void> {
    await apiClient.delete(`/academics/sections/${id}/`);
  },
};
