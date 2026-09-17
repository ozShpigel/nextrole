interface ApiOptions extends RequestInit {
  headers?: Record<string, string>;
}

interface ApiError extends Error {
  status?: number;
  data?: Record<string, unknown>;
}

// The uid cookie identifies the user (see docs/multi-user.md). Both the Vite
// dev proxy and the deployed nginx serve the client and both services from one
// origin, where the browser sends cookies anyway; `credentials: 'include'` is
// set explicitly so a cross-origin deploy (VITE_API_URL pointing elsewhere)
// keeps working rather than silently losing identity.
const API_BASE      = (import.meta.env.VITE_API_URL     || '').replace(/\/$/, '');

// Surfaced when the read-only demo instance blocks a write (HTTP 403).
const DEMO_BLOCKED_MSG = 'This action is disabled in the read-only demo.';

// Builds a plain /api URL for cases that need a real href rather than a
// fetch()+JSON round-trip — e.g. an <a download> link to a PDF endpoint.
export function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}/api${path}` : `/api${path}`;
}

export async function api(path: string, options: ApiOptions = {}) {
  const { headers, ...fetchOptions } = options;
  const url = API_BASE ? `${API_BASE}/api${path}` : `/api${path}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  });
  if (!res.ok && res.status !== 204) {
    if (res.status === 403) throw new Error(DEMO_BLOCKED_MSG);
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function matchApi(path: string, options: ApiOptions = {}) {
  const { headers, ...fetchOptions } = options;
  const url = API_BASE ? `${API_BASE}/api/match${path}` : `/api/match${path}`;
  // For FormData uploads, let the browser set Content-Type (with the multipart
  // boundary) — forcing application/json would break the request.
  const isForm = fetchOptions.body instanceof FormData;
  const res = await fetch(url, {
    credentials: 'include',
    headers: isForm ? { ...headers } : { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err: ApiError = new Error(
      res.status === 403 ? DEMO_BLOCKED_MSG : (data.detail || data.error || `HTTP ${res.status}`));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return res.json();
}


// Per-user state over the shared pool, plus importing a posting by URL.
//
// These are served by the API, not the scraper — they moved in Phase 1 of
// docs/scraper-slimming.md. They kept a prefix of their own rather than staying
// under /api/discovery, because nginx proxies that prefix to the scraper as one
// block and splitting it by sub-path is how a route goes missing unnoticed.
//
// As of Phase 3 the browser has no other backend. `discoveryApi` and
// `scraperApi` lived here until the last route moved into the API, which now
// fetches postings through the scraper on the client's behalf -- so the client
// does not call the scraper at all.
export async function poolApi(path: string, options: ApiOptions = {}) {
  const { headers, ...fetchOptions } = options;
  const url = API_BASE ? `${API_BASE}/api/pool${path}` : `/api/pool${path}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    const err: ApiError = new Error(
      res.status === 403 ? DEMO_BLOCKED_MSG : (data.detail || data.error || `HTTP ${res.status}`));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

