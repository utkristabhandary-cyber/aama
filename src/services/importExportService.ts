/** Server-backed template & export downloads (Phase H).
 *
 * The backend is the single source of truth: every route below is admin-only
 * and returns a real .xlsx (template = headers-only + contract, export = real
 * rows with alias-compatible headers that round-trip through the importer).
 * This service only builds the endpoint and triggers the authenticated
 * download; it never fabricates data or workbook structure.
 */

import { downloadBytes, saveDownload } from './apiClient';

export type ImportExportKind = 'students' | 'teachers' | 'timetable';
export type ImportExportAction = 'template' | 'export';

export const importExportEndpoints: Record<
  ImportExportKind,
  Record<ImportExportAction, string>
> = {
  students: {
    template: '/imports/students/template/',
    export: '/imports/students/export/',
  },
  teachers: {
    template: '/imports/teachers/template/',
    export: '/imports/teachers/export/',
  },
  timetable: {
    template: '/academics/timetable-import/template/',
    export: '/academics/timetable-import/export/',
  },
};

export function buildImportEndpoint(
  kind: ImportExportKind,
  action: ImportExportAction,
): string {
  return importExportEndpoints[kind][action];
}

/**
 * Download a server-generated .xlsx. Returns the filename the browser will
 * save (server-provided, or the fallback when the response omits it).
 */
export async function downloadImportFile(
  kind: ImportExportKind,
  action: ImportExportAction,
  fallbackFilename: string,
): Promise<string> {
  const { blob, filename } = await downloadBytes(
    buildImportEndpoint(kind, action),
    fallbackFilename,
  );
  saveDownload(blob, filename);
  return filename;
}