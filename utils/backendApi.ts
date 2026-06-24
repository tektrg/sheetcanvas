export const getBackendBaseUrl = () => {
  const fromEnv = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const host = typeof location !== 'undefined' ? location.hostname : '';
  if (
    !host ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local')
  ) {
    return 'http://localhost:8787';
  }

  return typeof location !== 'undefined' ? location.origin : 'http://localhost:8787';
};

const getBearerToken = () => {
  const token = (import.meta as any).env?.VITE_API_BEARER_TOKEN as string | undefined;
  return token && token.trim() ? token.trim() : null;
};

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function isConnectorNeedsReconnectError(error: unknown) {
  return error instanceof ApiError && error.code === 'connector_needs_reconnect';
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getBackendBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');

  const token = getBearerToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, json?.error?.code || json?.code);
  }
  return json as T;
}
