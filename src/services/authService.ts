import { User } from '../types';
import { apiClient, getToken, setToken } from './apiClient';

const LEGACY_USER_KEY = 'aams_current_user';

// Simulated latency helper for consistent loading states across the app.
export const delay = (ms = 80) => new Promise(res => setTimeout(res, ms));

export interface MePayload {
  id: number;
  name: string;
  email: string;
  username: string;
  status: 'active' | 'inactive';
  role: 'admin' | 'teacher' | 'student';
  department?: string;
  teacher_id?: string;
  student_id?: string;
  semester_id?: number;
  section_id?: number;
  must_change_password: boolean;
}

/** Map the DRF `/auth/me/` payload onto the frontend User shape. */
export function mapUser(payload: MePayload): User {
  return {
    id: String(payload.id),
    name: payload.name,
    email: payload.email,
    username: payload.username,
    status: payload.status,
    role: payload.role,
    department: payload.department,
    teacherId: payload.teacher_id,
    studentId: payload.student_id,
    semesterId: payload.semester_id != null ? String(payload.semester_id) : undefined,
    sectionId: payload.section_id != null ? String(payload.section_id) : undefined,
    mustChangePassword: payload.must_change_password === true,
  };
}

/** Remove mock-era session artifacts so they can never leak into live auth. */
function clearLegacyMockSession(): void {
  localStorage.removeItem(LEGACY_USER_KEY);
  localStorage.removeItem('aams_auth_token');
}

export const authService = {
  async getCurrentUser(): Promise<User | null> {
    await delay(30);
    if (!getToken()) {
      clearLegacyMockSession();
      return null;
    }
    try {
      const payload = await apiClient.me<MePayload>();
      return mapUser(payload);
    } catch (err) {
      // Invalid/expired token (ApiError 401 already cleared storage).
      clearLegacyMockSession();
      console.error('Failed to restore authentication session:', err);
      return null;
    }
  },

  async login(username: string, password?: string): Promise<{ user: User; token: string }> {
    await delay(150);
    const { token } = await apiClient.login(username, password || '');
    const payload = await apiClient.me<MePayload>();
    const user = mapUser(payload);
    window.dispatchEvent(new CustomEvent('aams_auth_change', { detail: { user } }));
    return { user, token };
  },

  async logout(): Promise<void> {
    await delay(50);
    await apiClient.logout();
    clearLegacyMockSession();
    window.dispatchEvent(new CustomEvent('aams_auth_change', { detail: { user: null } }));
  },

  /**
   * Self-service password change (`POST /auth/password/change/`).
   *
   * The backend re-validates the new password against the full institutional
   * policy, clears `must_change_password`, and rotates every token. The new
   * token replaces the session token; the mapped user is broadcast so the
   * portal can leave the forced password-change gate.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<User> {
    await delay(120);
    const { token, user } = await apiClient.post<{ token: string; user: MePayload }>(
      '/auth/password/change/',
      { current_password: currentPassword, new_password: newPassword },
    );
    setToken(token);
    const mapped = mapUser(user);
    window.dispatchEvent(new CustomEvent('aams_auth_change', { detail: { user: mapped } }));
    return mapped;
  },

  /**
   * Admin-initiated reset (`POST /auth/password/reset/`).
   *
   * Puts the target account back into the fresh-provision state
   * (`must_change_password = true`, deterministic bootstrap password). The
   * password is never returned to anyone (docs/25 §16).
   */
  async adminResetPassword(username: string): Promise<unknown> {
    await delay(120);
    return apiClient.post('/auth/password/reset/', { username });
  },

  getToken(): string | null {
    return getToken();
  },
};