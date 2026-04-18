const RETRY_STATUSES = new Set([408, 429, 502, 503, 504]);
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 15000;

function computeDelay(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const secs = parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(secs) && secs > 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

async function fetchWithRetry(url, fetchOptions, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, fetchOptions);
      if (RETRY_STATUSES.has(res.status) && attempt < retries) {
        const delay = computeDelay(attempt, res.headers.get('Retry-After'));
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = computeDelay(attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

export async function api(path, options = {}) {
  const { headers, ...rest } = options;
  const res = await fetchWithRetry(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...rest,
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function profileApi(path, options = {}) {
  const { headers, ...rest } = options;
  const res = await fetchWithRetry(`/api/match${path}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...rest,
  });
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
  const { headers, ...rest } = options;
  const res = await fetchWithRetry(`/api/discovery${path}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...rest,
  });
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
