import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  timesheetService,
  buildTimesheetQuery,
  buildTimesheetExportPath,
  TIMESHEET_EXPORT_FILENAME,
  TIMESHEET_ENTRIES_PATH,
} from './timesheetService';
import { apiClient } from './apiClient';
import type {
  ApiTimesheetEntry,
  ApiTimesheetEntryCreate,
  ApiTimesheetSummary,
} from '../types/api';

const { saveDownloadSpy, downloadBytesSpy } = vi.hoisted(() => ({
  saveDownloadSpy: vi.fn(),
  downloadBytesSpy: vi.fn(),
}));

vi.mock('./apiClient', async importOriginal => {
  const actual = await importOriginal<typeof import('./apiClient')>();
  return {
    ...actual,
    downloadBytes: downloadBytesSpy,
    saveDownload: (blob: Blob, filename: string) => saveDownloadSpy(blob, filename),
  };
});

const baseEntry: ApiTimesheetEntry = {
  id: 1,
  teacher: 3,
  teacher_name: 'Ritu Sharma',
  entry_date: '2026-09-19',
  type: 'class',
  subject: 7,
  subject_code: 'CS101',
  subject_name: 'Programming Fundamentals',
  section_ids: [4],
  sections: [4],
  section_names: ['A'],
  semester: 1,
  semester_name: 'Sem 1',
  start_time: '09:00:00',
  end_time: '10:00:00',
  duration_minutes: 60,
  note: '',
  status: 'draft',
  rejection_reason: '',
  is_holiday: false,
  holiday_title: '',
  created_at: '2026-09-19T09:00:00Z',
  updated_at: '2026-09-19T09:00:00Z',
};

const summary: ApiTimesheetSummary = {
  count: 2,
  duration_minutes: 130,
  by_type: { class: 60, duty: 70 },
  by_day: [{ entry_date: '2026-09-19', duration_minutes: 130 }],
  per_teacher: [
    { teacher: 3, teacher_name: 'Ritu Sharma', count: 2, duration_minutes: 130 },
  ],
};

describe('buildTimesheetQuery', () => {
  it('omits empty and unresolved filters', () => {
    expect(
      buildTimesheetQuery({
        type: 'class',
        status: '',
        semester: undefined,
        teacher: null,
        date_from: '2026-01-01',
        date_to: '',
      }),
    ).toEqual({ type: 'class', date_from: '2026-01-01' });
  });

  it('returns an empty object when no filters are given', () => {
    expect(buildTimesheetQuery(undefined)).toEqual({});
    expect(buildTimesheetQuery({})).toEqual({});
  });
});

describe('buildTimesheetExportPath', () => {
  it('builds a query string from present filters only', () => {
    expect(
      buildTimesheetExportPath({
        type: 'duty',
        teacher: '3',
        status: '',
      }),
    ).toBe('?type=duty&teacher=3');
  });

  it('returns an empty suffix when unfiltered', () => {
    expect(buildTimesheetExportPath()).toBe('');
  });
});

describe('timesheetService CRUD', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  let listSpy: ReturnType<typeof vi.spyOn>;
  let postSpy: ReturnType<typeof vi.spyOn>;
  let patchSpy: ReturnType<typeof vi.spyOn>;
  let deleteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue(baseEntry);
    listSpy = vi.spyOn(apiClient, 'list').mockResolvedValue([baseEntry]);
    postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue(baseEntry);
    patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue(baseEntry);
    deleteSpy = vi.spyOn(apiClient, 'delete').mockResolvedValue(undefined);
    saveDownloadSpy.mockClear();
  });

  it('lists entries with the serialized filters', async () => {
    await timesheetService.listEntries({ type: 'other', status: 'confirmed', date_from: '2026-01-01' });

    expect(listSpy).toHaveBeenCalledWith(TIMESHEET_ENTRIES_PATH, {
      type: 'other',
      status: 'confirmed',
      date_from: '2026-01-01',
    });
  });

  it('lists entries without a query when unfiltered', async () => {
    await timesheetService.listEntries();
    expect(listSpy).toHaveBeenCalledWith(TIMESHEET_ENTRIES_PATH, {});
  });

  it('gets a single entry', async () => {
    await timesheetService.getEntry(9);
    expect(getSpy).toHaveBeenCalledWith('/timesheet/entries/9/');
  });

  it('creates an entry with the write payload', async () => {
    const payload: ApiTimesheetEntryCreate = {
      entry_date: '2026-09-19',
      type: 'duty',
      start_time: '10:00',
      end_time: '11:30',
      note: 'Lab prep',
    };
    await timesheetService.createEntry(payload);

    expect(postSpy).toHaveBeenCalledWith(TIMESHEET_ENTRIES_PATH, payload);
  });

  it('updates an entry via PATCH', async () => {
    await timesheetService.updateEntry(5, { note: 'Revised' });
    expect(patchSpy).toHaveBeenCalledWith('/timesheet/entries/5/', { note: 'Revised' });
  });

  it('deletes an entry', async () => {
    await timesheetService.deleteEntry(5);
    expect(deleteSpy).toHaveBeenCalledWith('/timesheet/entries/5/');
  });
});

describe('timesheetService workflow actions', () => {
  let postSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue(baseEntry);
  });

  it('submits a draft entry', async () => {
    await timesheetService.submitEntry(1);
    expect(postSpy).toHaveBeenCalledWith('/timesheet/entries/1/submit/');
  });

  it('recalls a submitted entry', async () => {
    await timesheetService.recallEntry(1);
    expect(postSpy).toHaveBeenCalledWith('/timesheet/entries/1/recall/');
  });

  it('confirms a submitted entry', async () => {
    await timesheetService.confirmEntry(1);
    expect(postSpy).toHaveBeenCalledWith('/timesheet/entries/1/confirm/');
  });

  it('rejects a submitted entry with the server-expected reason key', async () => {
    await timesheetService.rejectEntry(1, 'Overlaps with lesson log');
    expect(postSpy).toHaveBeenCalledWith('/timesheet/entries/1/reject/', {
      rejectionReason: 'Overlaps with lesson log',
    });
  });
});

describe('timesheetService summary and export', () => {
  let getSpy: ReturnType<typeof vi.spyOn>;
  let listSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue(summary);
    listSpy = vi.spyOn(apiClient, 'list').mockResolvedValue([baseEntry]);
    saveDownloadSpy.mockClear();
    downloadBytesSpy.mockReset().mockResolvedValue({
      blob: new Blob(['PK']),
      filename: TIMESHEET_EXPORT_FILENAME,
    });
  });

  it('fetches the CONFIRMED-only summary with filters', async () => {
    await timesheetService.getSummary({ teacher: '3', date_from: '2026-01-01' });

    expect(getSpy).toHaveBeenCalledWith('/timesheet/summary/', {
      teacher: '3',
      date_from: '2026-01-01',
    });
  });

  it('downloads the export workbook and triggers a browser save', async () => {
    const filename = await timesheetService.exportEntries({ status: 'confirmed' });

    expect(listSpy).not.toHaveBeenCalled();
    expect(filename).toBe(TIMESHEET_EXPORT_FILENAME);
    expect(saveDownloadSpy).toHaveBeenCalledTimes(1);
  });

  it('routes the export to the raw export route with a query string', async () => {
    await timesheetService.exportEntries({ type: 'class', status: '' });

    expect(downloadBytesSpy).toHaveBeenCalledWith(
      '/timesheet/export/?type=class',
      TIMESHEET_EXPORT_FILENAME,
    );
  });
});