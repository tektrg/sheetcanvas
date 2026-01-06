const getBaseUrl = () => {
  const fromEnv = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
  return (fromEnv && fromEnv.trim()) || 'http://localhost:8787';
};

const getBearerToken = () => {
  const token = (import.meta as any).env?.VITE_API_BEARER_TOKEN as string | undefined;
  return token && token.trim() ? token.trim() : null;
};

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getBaseUrl();
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
    throw new Error(msg);
  }
  return json as T;
}
