import { apiClient } from './apiClient';
import type {
  ApiTimetableImportConfirm,
  ApiTimetableImportPreview,
  ApiTimetableImportSession,
} from '../types/api';

/**
 * Honest admin timetable .xlsx import against the live backend
 * (`/academics/timetable-import/`). The backend parses, normalizes, matches
 * and validates the workbook, stages the plan on a pending session, and only
 * commits rows through the separate confirm step.
 */
export const timetableImportService = {
  async preview(file: File): Promise<ApiTimetableImportPreview> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<ApiTimetableImportPreview>('/academics/timetable-import/preview/', form);
  },

  async confirm(sessionUuid: string): Promise<ApiTimetableImportConfirm> {
    return apiClient.post<ApiTimetableImportConfirm>('/academics/timetable-import/confirm/', {
      session_uuid: sessionUuid,
    });
  },

  async getHistory(): Promise<ApiTimetableImportSession[]> {
    return apiClient.list<ApiTimetableImportSession>('/academics/timetable-import/');
  },
};