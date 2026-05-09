interface ApiOptions extends RequestInit {
  headers?: Record<string, string>;
}

interface ApiError extends Error {
  status?: number;
  data?: Record<string, unknown>;
}

const API_BASE      = (import.meta.env.VITE_API_URL     || '').replace(/\/$/, '');
const SCRAPER_BASE  = (import.meta.env.VITE_SCRAPER_URL || '').replace(/\/$/, '');

export async function api(path: string, options: ApiOptions = {}) {
  const { headers, ...fetchOptions } = options;
  const url = API_BASE ? `${API_BASE}/api${path}` : `/api${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function matchApi(path: string, options: ApiOptions = {}) {
  const { headers, ...fetchOptions } = options;
  const url = API_BASE ? `${API_BASE}/api/match${path}` : `/api/match${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err: ApiError = new Error(data.detail || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return res.json();
}

export async function discoveryApi(path: string, options: ApiOptions = {}) {
  const { headers, ...fetchOptions } = options;
  const url = SCRAPER_BASE ? `${SCRAPER_BASE}/api/discovery${path}` : `/api/discovery${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    const err: ApiError = new Error(data.detail || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}
