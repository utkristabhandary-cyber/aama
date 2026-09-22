/** Thin fetch wrapper for the Django REST Framework backend.
 *
 * Reads the API base URL from `VITE_API_BASE_URL` (see `.env.example`). The
 * auth token lives in `sessionStorage` (single source of truth); any legacy
 * token maps are also removed so an old session can never leak through.
 */

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api').replace(/\/+$/, '');

const TOKEN_KEY = 'aams_auth_token';
const LEGACY_TOKEN_KEY = 'aams_auth_token';
const LEGACY_USER_KEY = 'aams_current_user';

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
}

/** Remove the session from every storage location (session + legacy local). */
export function clearToken(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(TOKEN_KEY);
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_USER_KEY);
}

/** Flatten a DRF-style error payload into a human-readable message. */
export function errorMessage(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    const parts: string[] = [];
    for (const [key, value] of Object.entries(rec)) {
      if (Array.isArray(value)) {
        parts.push(value.map(String).join(' '));
      } else if (typeof value === 'object' && value !== null) {
        parts.push(errorMessage(value));
      } else {
        parts.push(String(value));
      }
    }
    return parts.filter(Boolean).join(' ') || `Request failed (${JSON.stringify(data)})`;
  }
  return `Request failed (${String(data)})`;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

/** DRF PageNumberPagination envelope for list endpoints. */
export interface PaginatedResult<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = options;

  const url = new URL(API_BASE_URL + path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Token ${token}`;

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (body instanceof FormData) {
      payload = body;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  const response = await fetch(url.toString(), { method, headers, body: payload });

  const data = await parseResponse(response);
  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('aams:unauthorized'));
  }
  if (!response.ok) {
    // DRF's throttle response is generic; give the user a useful, safe hint
    // without leaking the failure reason from the backend.
    let message = errorMessage(data);
    if (response.status === 429) {
      message =
        'Too many sign-in attempts. Please wait a moment and try again.';
    }
    throw new ApiError(response.status, message, data);
  }
  return data as T;
}

/** Extract the ``filename="..."`` from a Content-Disposition header. */
export function extractFilename(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = disposition.match(/filename="([^"]+)"/i);
  return match ? match[1] : null;
}

/** Trigger a browser download of the given bytes. No-op outside a browser. */
export function saveDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fetch binary content (e.g. a server-generated .xlsx) with the auth token.
 *
 * Returns the blob and the attachment filename (falling back to
 * ``fallbackFilename`` when the response carries no Content-Disposition). On a
 * non-OK response it mirrors ``request``: raises an ``ApiError`` and clears
 * the session on 401. Uses an absolute base URL so it is testable in a plain
 * node environment.
 */
export async function downloadBytes(
  path: string,
  fallbackFilename: string,
): Promise<{ blob: Blob; filename: string }> {
  const url = new URL(API_BASE_URL + path, 'http://localhost').toString();
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Token ${token}`;

  const response = await fetch(url, { headers });
  if (response.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aams:unauthorized'));
    }
  }
  if (!response.ok) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    throw new ApiError(response.status, errorMessage(data), data);
  }

  const blob = await response.blob();
  const filename =
    extractFilename(response.headers.get('Content-Disposition')) || fallbackFilename;
  return { blob, filename };
}

export const apiClient = {
  get: <T>(path: string, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'GET', query }),

  /**
   * Fetch a DRF list and return its entries.
   *
   * Standard list endpoints are behind PageNumberPagination (`PAGE_SIZE=100`)
   * and return `{count,next,previous,results}`. A few teacher-scoped custom
   * actions (`/teachers/students/`, `/teachers/reports/`) return a raw array.
   * Both shapes are unwrapped here, so all list reads must go through this
   * helper rather than mapping over the raw GET.
   */
  list: <T>(path: string, query?: RequestOptions['query']) =>
    request<PaginatedResult<T> | T[]>(path, { method: 'GET', query }).then(res =>
      Array.isArray(res) ? res : res.results,
    ),

  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  // Convenience auth helpers wired to the live backend endpoints.
  // Login is username-based: students use their college-issued student ID
  // (e.g. `std-1`), teachers their teacher ID (e.g. `tch-3`), admins `admin`.
  login: async (username: string, password: string) =>
    request<{ token: string; user: unknown }>('/auth/login/', {
      method: 'POST',
      body: { username, password },
    }).then(result => {
      setToken(result.token);
      return result;
    }),
  me: <T>() => request<T>('/auth/me/'),
  logout: async () => {
    try {
      await request<unknown>('/auth/logout/', { method: 'POST' });
    } finally {
      clearToken();
    }
  },
};