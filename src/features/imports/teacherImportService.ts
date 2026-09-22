/** Live backend API for the teacher institutional .xlsx import (Phase C). */
import { apiClient } from '../../services/apiClient';
import type {
  ApiImportSession,
  ApiTeacherImportConfirm,
  ApiTeacherImportPreview,
} from '../../types/api';

export const teacherImportService = {
  async preview(file: File): Promise<ApiTeacherImportPreview> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<ApiTeacherImportPreview>(
      '/imports/teachers/preview/',
      form,
    );
  },

  async confirm(sessionUuid: string): Promise<ApiTeacherImportConfirm> {
    return apiClient.post<ApiTeacherImportConfirm>(
      '/imports/teachers/confirm/',
      { session_uuid: sessionUuid },
    );
  },

  async getHistory(): Promise<ApiImportSession[]> {
    return apiClient.list<ApiImportSession>('/imports/teachers/');
  },
};
