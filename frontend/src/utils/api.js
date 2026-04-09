export async function api(path, options = {}) {
  const { headers, ...rest } = options;
  const res = await fetch(`/api${path}`, {
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

export async function matchApi(path, options = {}) {
  const { headers, ...rest } = options;
  const res = await fetch(`/api/match${path}`, {
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
