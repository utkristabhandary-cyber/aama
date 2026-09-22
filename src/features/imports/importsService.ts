import { apiClient } from '../../services/apiClient';
import type {
  ApiImportKind,
  ApiImportPreview,
  ApiImportSession,
} from '../../types/api';

/**
 * Admin institutional .xlsx import against the live backend
 * (`/imports/<kind>/preview/`).
 *
 * Phase A is deliberate: there is NO confirm step here. Upload/preview only
 * parses, normalizes and classifies the workbook into a pending staging
 * session; the server reports whether confirmation (a later phase) would be
 * blocked. Nothing is ever written by this service.
 */
export const importsService = {
  async preview(kind: ApiImportKind, file: File): Promise<ApiImportPreview> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<ApiImportPreview>(`/imports/${kind}/preview/`, form);
  },

  async getHistory(kind: ApiImportKind): Promise<ApiImportSession[]> {
    return apiClient.list<ApiImportSession>(`/imports/${kind}/`);
  },
};