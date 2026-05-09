const RETRY_STATUSES = new Set([408, 429, 502, 503, 504]);
const MAX_RETRIES = 8;
const MAX_BACKOFF_MS = 20000;
const MIN_BACKOFF_MS = 0;

interface RetryInfo {
  attempt: number;
  delayMs: number;
  reason: 'status' | 'network';
  status?: number;
}

type OnRetryCallback = (info: RetryInfo) => void;

interface ApiOptions extends RequestInit {
  headers?: Record<string, string>;
  retries?: number;
  onRetry?: OnRetryCallback;
  retryMinDelayMs?: number;
  retryMaxDelayMs?: number;
}

interface ApiError extends Error {
  status?: number;
  data?: Record<string, unknown>;
}

function computeDelay(attempt: number, retryAfterHeader: string | null, maxMs = MAX_BACKOFF_MS, minMs = MIN_BACKOFF_MS): number {
  if (retryAfterHeader) {
    const secs = parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(secs) && secs > 0) return Math.min(Math.max(secs * 1000, minMs), maxMs);
  }
  return Math.min(Math.max(1000 * 2 ** attempt, minMs), maxMs);
}

async function fetchWithRetry(
  url: string,
  fetchOptions: RequestInit,
  retries = MAX_RETRIES,
  onRetry?: OnRetryCallback,
  minDelayMs?: number,
  maxDelayMs?: number,
): Promise<Response> {
  const maxMs = maxDelayMs ?? MAX_BACKOFF_MS;
  const minMs = minDelayMs ?? MIN_BACKOFF_MS;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, fetchOptions);
      if (RETRY_STATUSES.has(res.status) && attempt < retries) {
        const delay = computeDelay(attempt, res.headers.get('Retry-After'), maxMs, minMs);
        if (onRetry) onRetry({ attempt: attempt + 1, delayMs: delay, reason: 'status', status: res.status });
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = computeDelay(attempt, null, maxMs, minMs);
      if (onRetry) onRetry({ attempt: attempt + 1, delayMs: delay, reason: 'network' });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('fetchWithRetry: exhausted retries');
}

function extractRetryOptions(options: ApiOptions = {}) {
  const { headers, retries, onRetry, retryMinDelayMs, retryMaxDelayMs, ...rest } = options;
  return { fetchOptions: rest as RequestInit, headers, retries, onRetry, retryMinDelayMs, retryMaxDelayMs };
}

const API_BASE      = (import.meta.env.VITE_API_URL     || '').replace(/\/$/, '');
const SCRAPER_BASE  = (import.meta.env.VITE_SCRAPER_URL || '').replace(/\/$/, '');

export async function api(path: string, options: ApiOptions = {}) {
  const { fetchOptions, headers, retries, onRetry, retryMinDelayMs, retryMaxDelayMs } = extractRetryOptions(options);
  const url = API_BASE ? `${API_BASE}/api${path}` : `/api${path}`;
  const res = await fetchWithRetry(url, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  }, retries, onRetry, retryMinDelayMs, retryMaxDelayMs);
  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function matchApi(path: string, options: ApiOptions = {}) {
  const { fetchOptions, headers, retries, onRetry, retryMinDelayMs, retryMaxDelayMs } = extractRetryOptions(options);
  const url = API_BASE ? `${API_BASE}/api/match${path}` : `/api/match${path}`;
  const res = await fetchWithRetry(url, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  }, retries, onRetry, retryMinDelayMs, retryMaxDelayMs);
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
  const { fetchOptions, headers, retries, onRetry, retryMinDelayMs, retryMaxDelayMs } = extractRetryOptions(options);
  const url = SCRAPER_BASE ? `${SCRAPER_BASE}/api/discovery${path}` : `/api/discovery${path}`;
  const res = await fetchWithRetry(url, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  }, retries, onRetry, retryMinDelayMs, retryMaxDelayMs);
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
