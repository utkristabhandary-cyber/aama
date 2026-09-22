import { Holiday, HolidayType } from '../types';
import { ApiHoliday } from '../types/api';
import { apiClient } from './apiClient';

function toViewModel(api: ApiHoliday): Holiday {
  return {
    id: String(api.id),
    date: api.date,
    title: api.title,
    description: api.description || '',
    type: api.type as HolidayType,
  };
}

export const holidayService = {
  /**
   * Holidays come from the authoritative backend (`/academics/holidays/`),
   * not the mock store, so teacher/student dashboards reflect institutional data.
   */
  async getHolidays(): Promise<Holiday[]> {
    const list = await apiClient.list<ApiHoliday>('/academics/holidays/');
    return list
      .map(toViewModel)
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  async isHolidayDate(dateStr: string): Promise<Holiday | undefined> {
    const holidays = await this.getHolidays();
    return holidays.find(h => h.date === dateStr);
  },

  /**
   * Holidays are created on the backend (`POST /academics/holidays/`, admin
   * only). The server records the holiday; no client-side fake notification
   * is dispatched, since notifications are also backend-owned.
   */
  async declareHoliday(data: Omit<Holiday, 'id'>): Promise<Holiday> {
    const saved = await apiClient.post<ApiHoliday>('/academics/holidays/', {
      date: data.date,
      title: data.title,
      description: data.description || '',
      type: data.type,
    });
    return toViewModel(saved);
  },

  async deleteHoliday(id: string): Promise<void> {
    await apiClient.delete(`/academics/holidays/${id}/`);
  },
};
