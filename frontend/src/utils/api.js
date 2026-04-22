const RETRY_STATUSES = new Set([408, 429, 502, 503, 504]);
// Render free tier services sleep after 15 min idle and cold-start in 30–90s.
// Budget: 1+2+4+8+16+20+20+20 ≈ 91s across 9 attempts, enough to ride out a wake-up.
const MAX_RETRIES = 8;
const MAX_BACKOFF_MS = 20000;
const MIN_BACKOFF_MS = 0;

function computeDelay(attempt, retryAfterHeader, maxMs = MAX_BACKOFF_MS, minMs = MIN_BACKOFF_MS) {
  if (retryAfterHeader) {
    const secs = parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(secs) && secs > 0) return Math.min(Math.max(secs * 1000, minMs), maxMs);
  }
  return Math.min(Math.max(1000 * 2 ** attempt, minMs), maxMs);
}

async function fetchWithRetry(url, fetchOptions, retries = MAX_RETRIES, onRetry, minDelayMs, maxDelayMs) {
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
}

function extractRetryOptions(options = {}) {
  const { headers, retries, onRetry, retryMinDelayMs, retryMaxDelayMs, ...rest } = options;
  return { fetchOptions: rest, headers, retries, onRetry, retryMinDelayMs, retryMaxDelayMs };
}

// Direct-call base URLs. When a VITE_*_URL build arg is set, the SPA calls the
// corresponding service directly from the browser (CORS) — the candy-babies
// pattern that avoids amplifying Render cold-start 502s through the nginx
// reverse-proxy. Empty = fall back to the nginx-proxied path for local
// `docker compose` where the browser can't resolve internal hostnames.
const API_BASE      = (import.meta.env.VITE_API_URL     || '').replace(/\/$/, '');
const SCRAPER_BASE  = (import.meta.env.VITE_SCRAPER_URL || '').replace(/\/$/, '');

export async function api(path, options = {}) {
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

export async function profileApi(path, options = {}) {
  const { fetchOptions, headers, retries, onRetry, retryMinDelayMs, retryMaxDelayMs } = extractRetryOptions(options);
  const url = API_BASE ? `${API_BASE}/api/match${path}` : `/api/match${path}`;
  const res = await fetchWithRetry(url, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  }, retries, onRetry, retryMinDelayMs, retryMaxDelayMs);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.detail || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return res.json();
}

export async function discoveryApi(path, options = {}) {
  const { fetchOptions, headers, retries, onRetry, retryMinDelayMs, retryMaxDelayMs } = extractRetryOptions(options);
  const url = SCRAPER_BASE ? `${SCRAPER_BASE}/api/discovery${path}` : `/api/discovery${path}`;
  const res = await fetchWithRetry(url, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...fetchOptions,
  }, retries, onRetry, retryMinDelayMs, retryMaxDelayMs);
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.detail || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}
