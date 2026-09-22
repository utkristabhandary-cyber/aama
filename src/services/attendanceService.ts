import { apiClient } from './apiClient';
import {
  ApiAttendanceSession,
  ApiAttendanceSessionCreate,
  ApiAttendanceStatus,
  ApiAttendanceRecord,
  ApiRollResponse,
  ApiQRAttendanceSession,
  ApiQRCheckInRequest,
  ApiQRCheckInResponse,
  ApiNetworkVerificationMethod,
  ApiQRValidateResponse,
} from '../types/api';

/**
 * Phase 5: authoritative attendance session engine backed by
 * `/attendance/sessions/` on the Django REST Framework backend.
 *
 * There is deliberately no mock/store/delay path here: session creation,
 * roll, marking, finalization, and deletion are all server-authoritative.
 * Unmarked students simply have no record row (status `null` in the roll),
 * and a finalized session is immutable server-side.
 */
export const attendanceService = {
  /** Create (or reopen) an attendance session; rejects server-side duplicates. */
  createSession(data: ApiAttendanceSessionCreate): Promise<ApiAttendanceSession> {
    return apiClient.post<ApiAttendanceSession>('/attendance/sessions/', data);
  },

  /**
   * List attendance sessions. Optional server-side filters map 1:1 to the
   * viewset's `characteristics` query params (semester/section/subject/teacher).
   */
  getSessions(filters?: {
    semesterId?: string | number;
    sectionId?: string | number;
    subjectId?: string | number;
    teacherId?: string | number;
  }): Promise<ApiAttendanceSession[]> {
    return apiClient.list<ApiAttendanceSession>('/attendance/sessions/', {
      semester: filters?.semesterId,
      section: filters?.sectionId,
      subject: filters?.subjectId,
      teacher: filters?.teacherId,
    });
  },

  getSessionById(id: string | number): Promise<ApiAttendanceSession> {
    return apiClient.get<ApiAttendanceSession>(`/attendance/sessions/${id}/`);
  },

  /** The server-authoritative roster for a session (unmarked = `status: null`). */
  getRoll(sessionId: string | number): Promise<ApiRollResponse> {
    return apiClient.get<ApiRollResponse>(`/attendance/sessions/${sessionId}/roll/`);
  },

  /** Idempotently mark one student (present/absent/late). Returns the record. */
  markStudent(
    sessionId: string | number,
    studentId: string | number,
    status: ApiAttendanceStatus,
  ): Promise<ApiAttendanceRecord> {
    return apiClient.post<ApiAttendanceRecord>(`/attendance/sessions/${sessionId}/mark/`, {
      studentId,
      status,
    });
  },

  /**
   * Atomically mark many students at once. The backend validates every entry
   * before writing anything, so one invalid row rejects the entire batch.
   */
  bulkMarkStudents(
    sessionId: string | number,
    marks: { studentId: string | number; status: ApiAttendanceStatus }[],
  ): Promise<ApiAttendanceRecord[]> {
    return apiClient.post<ApiAttendanceRecord[]>(
      `/attendance/sessions/${sessionId}/bulk_mark/`,
      { marks },
    );
  },

  /** Finalize the session with the explicit marked-student list. Immutable afterwards. */
  submitSession(
    sessionId: string | number,
    payload: { markedIds?: number[]; lateReason?: string },
  ): Promise<ApiAttendanceSession> {
    return apiClient.post<ApiAttendanceSession>(`/attendance/sessions/${sessionId}/submit/`, {
      markedIds: payload.markedIds ?? [],
      lateReason: payload.lateReason ?? '',
    });
  },

  /** Delete a session. Blocked server-side once the session is finalized. */
  deleteAttendanceSession(id: string | number): Promise<void> {
    return apiClient.delete(`/attendance/sessions/${id}/`);
  },

  // -------------------------------------------------------------------------
  // Phase 6: secure QR attendance check-in
  //
  // The token rotates server-side inside `QRAttendanceSession`; the client only
  // renders the payload the server returns (`AAMSQR1|<session id>|<TOKEN>`) and
  // never generates or verifies a token itself. Identity is always derived from
  // the authenticated user on the backend (`request.user.student_profile`).
  // -------------------------------------------------------------------------

  /**
   * Start (or refresh) the single active QR session for the authenticated
   * teacher and the given attendance session. Each call rotates the token
   * server-side and returns the fresh payload to render. Rejects with 403/400
   * if the session is finalized or not owned by the teacher.
   */
  startQRSession(attendanceSessionId: string | number): Promise<ApiQRAttendanceSession> {
    return apiClient.post<ApiQRAttendanceSession>('/attendance/qr/start/', {
      attendanceSessionId,
    });
  },

  /**
   * Re-read a teacher's own QR session. Useful to observe the live token /
   * check-in count; re-serialization also rotates the token lazily on expiry.
   */
  getQRSession(qrSessionId: string | number): Promise<ApiQRAttendanceSession> {
    return apiClient.get<ApiQRAttendanceSession>(`/attendance/qr/${qrSessionId}/`);
  },

  /** Stop the QR session so further scans are rejected ("no longer active"). */
  stopQRSession(qrSessionId: string | number): Promise<{ detail: string }> {
    return apiClient.post<{ detail: string }>(`/attendance/qr/${qrSessionId}/stop/`);
  },

  /**
   * Server-authoritative student check-in. Sends the full payload captured by
   * the camera (or typed manually) plus the honest web network report
   * (`unavailable` — a browser cannot attest a BSSID). The backend derives the
   * student identity from the session and returns 201 | 200 (already
   * recorded) | 4xx with a safe message.
   */
  checkInWithQR(qrPayload: string, networkMethod: ApiNetworkVerificationMethod = 'unavailable'): Promise<ApiQRCheckInResponse> {
    // The backend accepts absent `network` as `unavailable` too, but we always
    // state it explicitly to keep the payload self-documenting.
    const body: ApiQRCheckInRequest = { qrPayload, network: { method: networkMethod } };
    return apiClient.post<ApiQRCheckInResponse>('/attendance/qr/check-in/', body);
  },

  /** Validate a scanned/entered code against a QR session (student paths). */
  validateQR(qrSessionId: string | number, code: string): Promise<ApiQRValidateResponse> {
    return apiClient.post<ApiQRValidateResponse>(`/attendance/qr/${qrSessionId}/validate/`, { code });
  },
};