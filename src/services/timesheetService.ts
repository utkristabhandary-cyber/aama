import { apiClient, downloadBytes, saveDownload } from './apiClient';
import {
  ApiTimesheetEntry,
  ApiTimesheetEntryCreate,
  ApiTimesheetEntryUpdate,
  ApiTimesheetFilters,
  ApiTimesheetSummary,
} from '../types/api';

/**
 * Teacher timesheet API (Phase I).
 *
 * Backed by `/timesheet/*` on the Django REST Framework backend. The backend
 * owns every rule here: teacher identity is re-scoped per request from the
 * authenticated profile, `duration_minutes` is computed server-side, only
 * CONFIRMED entries count toward the summary ledger and the admin export, and
 * status transitions (draft -> submitted -> confirmed / rejected) are
 * enforced server-side. This module is deliberately a thin client.
 */

export const TIMESHEET_EXPORT_FILENAME = 'aams_timesheet_export.xlsx';
export const TIMESHEET_ENTRIES_PATH = '/timesheet/entries/';

export function buildTimesheetQuery(
  filters?: ApiTimesheetFilters,
): Record<string, string | number | boolean | undefined | null> {
  if (!filters) return {};
  const query: Record<string, string | number | boolean | undefined | null> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      query[key] = value;
    }
  }
  return query;
}

/** Query string to append to the raw export route (downloadBytes has no query API). */
export function buildTimesheetExportPath(filters?: ApiTimesheetFilters): string {
  const query = buildTimesheetQuery(filters);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function entryPath(id: number): string {
  return `${TIMESHEET_ENTRIES_PATH}${id}/`;
}

export const timesheetService = {
  async listEntries(filters?: ApiTimesheetFilters): Promise<ApiTimesheetEntry[]> {
    return apiClient.list<ApiTimesheetEntry>(TIMESHEET_ENTRIES_PATH, buildTimesheetQuery(filters));
  },

  async getEntry(id: number): Promise<ApiTimesheetEntry> {
    return apiClient.get<ApiTimesheetEntry>(entryPath(id));
  },

  async createEntry(data: ApiTimesheetEntryCreate): Promise<ApiTimesheetEntry> {
    return apiClient.post<ApiTimesheetEntry>(TIMESHEET_ENTRIES_PATH, data);
  },

  async updateEntry(id: number, data: ApiTimesheetEntryUpdate): Promise<ApiTimesheetEntry> {
    return apiClient.patch<ApiTimesheetEntry>(entryPath(id), data);
  },

  async deleteEntry(id: number): Promise<void> {
    return apiClient.delete(entryPath(id));
  },

  async submitEntry(id: number): Promise<ApiTimesheetEntry> {
    return apiClient.post<ApiTimesheetEntry>(`${entryPath(id)}submit/`);
  },

  async recallEntry(id: number): Promise<ApiTimesheetEntry> {
    return apiClient.post<ApiTimesheetEntry>(`${entryPath(id)}recall/`);
  },

  async confirmEntry(id: number): Promise<ApiTimesheetEntry> {
    return apiClient.post<ApiTimesheetEntry>(`${entryPath(id)}confirm/`);
  },

  async rejectEntry(id: number, reason: string): Promise<ApiTimesheetEntry> {
    return apiClient.post<ApiTimesheetEntry>(`${entryPath(id)}reject/`, {
      rejectionReason: reason,
    });
  },

  async getSummary(filters?: ApiTimesheetFilters): Promise<ApiTimesheetSummary> {
    return apiClient.get<ApiTimesheetSummary>('/timesheet/summary/', buildTimesheetQuery(filters));
  },

  /** Download the CONFIRMED-only ledger as a server-built .xlsx. */
  async exportEntries(filters?: ApiTimesheetFilters): Promise<string> {
    const { blob, filename } = await downloadBytes(
      `/timesheet/export/${buildTimesheetExportPath(filters)}`,
      TIMESHEET_EXPORT_FILENAME,
    );
    saveDownload(blob, filename);
    return filename;
  },
};