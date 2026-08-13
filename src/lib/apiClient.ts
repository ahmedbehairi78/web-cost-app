import { getApiAuthIdToken, ensureApiAuthToken } from './authToken';
import { isLocalBackend } from './dataBackend';
import {
  ApiPausedError,
  isAuthExemptApiPath,
  isAuthenticatedApiPaused,
  notifyApiUnauthorized,
} from './apiSession';
import { NetworkError } from './offline/NetworkError';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown,
  ) {
    super(message);
  }
}

export { NetworkError };

async function parseResponse(response: Response) {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isAuthenticatedApiPaused() && !isAuthExemptApiPath(path)) {
    throw new ApiPausedError();
  }
  let idToken = getApiAuthIdToken();
  if (isLocalBackend && !idToken) {
    idToken = await ensureApiAuthToken();
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed';
    throw new NetworkError(message);
  }
  const payload = await parseResponse(response);
  if (!response.ok) {
    if (response.status === 401 && !isAuthExemptApiPath(path)) {
      notifyApiUnauthorized();
    }
    throw new ApiError((payload as { error?: string })?.error || response.statusText, response.status, payload);
  }
  return payload as T;
}

export const apiClient = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};
