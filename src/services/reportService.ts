import { ApiAdminAnalytics, ApiReportSummary } from '../types/api';
import { apiClient } from './apiClient';

export const reportService = {
  /**
   * Server-computed attendance summary from `/reports/summary/`. The backend
   * scopes the data to the requester: teachers get their own sessions only,
   * admins get institution-wide numbers. Includes the at-risk student list.
   */
  async getScopedSummary(): Promise<ApiReportSummary> {
    return apiClient.get<ApiReportSummary>('/reports/summary/');
  },

  /**
   * Institution-wide analytics for the admin dashboard and admin reports view.
   * Admin-role only (`/reports/admin/`); teachers and students are blocked by
   * the backend, so callers must be the admin surfaces.
   */
  async getAdminAnalytics(): Promise<ApiAdminAnalytics> {
    return apiClient.get<ApiAdminAnalytics>('/reports/admin/');
  },

  exportAttendanceReportCSV(records: any[]): string {
    const headers = [
      'Roll No',
      'Student ID',
      'Student Name',
      'Semester',
      'Section',
      'Total Classes',
      'Attended',
      'Absent',
      'Late',
      'Attendance Percentage',
      'Status',
    ];

    const rows = records.map(r => [
      `"${r.rollNo || ''}"`,
      `"${r.studentId || ''}"`,
      `"${r.studentName || r.name || ''}"`,
      `"${r.semesterName || ''}"`,
      `"${r.sectionName || ''}"`,
      r.total || 0,
      r.present || 0,
      r.absent || 0,
      r.late || 0,
      `${r.percentage || 0}%`,
      r.percentage < 75 ? 'DEFAULTER (<75%)' : r.percentage < 85 ? 'AVERAGE' : 'GOOD',
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  },
};
