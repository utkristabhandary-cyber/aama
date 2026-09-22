/** Live backend API for the student institutional .xlsx import (Phase B). */
import { apiClient } from '../../services/apiClient';
import type {
  ApiImportSession,
  ApiStudentImportConfirm,
  ApiStudentImportPreview,
} from '../../types/api';

export const studentImportService = {
  async preview(file: File): Promise<ApiStudentImportPreview> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<ApiStudentImportPreview>(
      '/imports/students/preview/',
      form,
    );
  },

  async confirm(sessionUuid: string): Promise<ApiStudentImportConfirm> {
    return apiClient.post<ApiStudentImportConfirm>(
      '/imports/students/confirm/',
      { session_uuid: sessionUuid },
    );
  },

  async getHistory(): Promise<ApiImportSession[]> {
    return apiClient.list<ApiImportSession>('/imports/students/');
  },
};
