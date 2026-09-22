import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildImportEndpoint,
  downloadImportFile,
  importExportEndpoints,
} from './importExportService';
import { extractFilename } from './apiClient';

const saveDownloadSpy = vi.fn();

vi.mock('./apiClient', async importOriginal => {
  const actual = await importOriginal<typeof import('./apiClient')>();
  return {
    ...actual,
    saveDownload: (blob: Blob, filename: string) => saveDownloadSpy(blob, filename),
  };
});

describe('importExportService endpoints', () => {
  it('maps each kind to template and export routes', () => {
    expect(buildImportEndpoint('students', 'template')).toBe(
      '/imports/students/template/',
    );
    expect(buildImportEndpoint('students', 'export')).toBe('/imports/students/export/');
    expect(buildImportEndpoint('teachers', 'template')).toBe(
      '/imports/teachers/template/',
    );
    expect(buildImportEndpoint('teachers', 'export')).toBe('/imports/teachers/export/');
    expect(buildImportEndpoint('timetable', 'template')).toBe(
      '/academics/timetable-import/template/',
    );
    expect(buildImportEndpoint('timetable', 'export')).toBe(
      '/academics/timetable-import/export/',
    );
  });

  it('keeps every action for every kind present', () => {
    for (const kind of Object.keys(importExportEndpoints)) {
      expect(importExportEndpoints[kind].template).toBeTruthy();
      expect(importExportEndpoints[kind].export).toBeTruthy();
    }
  });
});

describe('extractFilename', () => {
  it('parses the server attachment filename', () => {
    expect(
      extractFilename('attachment; filename="aams_students_export.xlsx"'),
    ).toBe('aams_students_export.xlsx');
  });

  it('returns null when the disposition is missing', () => {
    expect(extractFilename(null)).toBeNull();
    expect(extractFilename('')).toBeNull();
  });
});

describe('downloadImportFile', () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saveDownloadSpy.mockClear();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    (globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: () => 'tok-123',
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('fetches the route with auth and triggers a browser save', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Blob(['PK']), {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="aams_teachers_export.xlsx"' },
      }),
    );

    const filename = await downloadImportFile('teachers', 'export', 'fallback.xlsx');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/imports/teachers/export/');
    expect(init.headers['Authorization']).toContain('Token');
    expect(filename).toBe('aams_teachers_export.xlsx');
    expect(saveDownloadSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the fallback filename when the server omits a disposition', async () => {
    fetchMock.mockResolvedValue(new Response(new Blob(['PK']), { status: 200 }));

    const filename = await downloadImportFile('students', 'template', 'fallback.xlsx');

    expect(filename).toBe('fallback.xlsx');
  });

  it('surfaces a server rejection as an error without saving', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      downloadImportFile('students', 'template', 'fallback.xlsx'),
    ).rejects.toThrow(/Forbidden/);
    expect(saveDownloadSpy).not.toHaveBeenCalled();
  });
});