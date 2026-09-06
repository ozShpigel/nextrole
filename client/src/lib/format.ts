// Seeded demo/fictional jobs (Seeder/Program.cs's Job() helper) get a
// placeholder job_url of https://example.com/jobs/<company-slug> — a real,
// resolvable domain, so the link doesn't error, it just opens IANA's
// generic "Example Domain" page with nothing job-related on it. A "View
// Job" link pointing at one is worse than no link — hide it instead.
const PLACEHOLDER_JOB_URL_PATTERN = /^https?:\/\/example\.com\/jobs\//i;

export function hasRealJobUrl(url: string | null | undefined): boolean {
  return !!url && !PLACEHOLDER_JOB_URL_PATTERN.test(url);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return `${formatDate(dateStr)} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ISO/UTC timestamp → the "YYYY-MM-DDTHH:mm" shape DateTimePicker (and the
// native datetime-local input it replaces) consume. That shape has no offset
// and is read as LOCAL wall-clock, so it has to be built from local getters —
// `toISOString().slice(0, 16)` yields the UTC wall-clock instead, which showed
// every edited interview 3 hours early (Israel) and re-saved it shifted.
export function toDateTimeLocalValue(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function scoreColor(score: number | null | undefined, max?: number | null): string {
  if (score == null) return 'var(--muted-foreground)';
  const pct = max != null && max > 0 ? score / max : score / 100;
  if (pct >= 0.6) return '#059669';
  if (pct >= 0.4) return '#d97706';
  return '#ef4444';
}

export function verdictColor(verdict: string | null | undefined): string {
  switch (verdict) {
    case 'STRONG_YES': return '#059669';
    case 'YES': return '#10b981';
    case 'MAYBE': return '#d97706';
    case 'NO': return '#ef4444';
    case 'STRONG_NO': return '#dc2626';
    default: return 'var(--muted-foreground)';
  }
}

export function verdictLabel(verdict: string | null | undefined): string {
  switch (verdict) {
    case 'STRONG_YES': return 'Strong Yes';
    case 'YES': return 'Yes';
    case 'MAYBE': return 'Maybe';
    case 'NO': return 'No';
    case 'STRONG_NO': return 'Strong No';
    case 'INSUFFICIENT_DATA': return 'N/A';
    default: return '-';
  }
}

export function barColor(score: number | null | undefined, max: number | null | undefined): string {
  if (score == null || max == null || max === 0) return 'red';
  const pct = score / max;
  if (pct >= 0.6) return 'green';
  if (pct >= 0.4) return 'yellow';
  return 'red';
}

export function isNew(discoveredAt: string | null | undefined): boolean {
  if (!discoveredAt) return false;
  const d = new Date(discoveredAt);
  if (isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
}

export function cityOnly(location: string | null | undefined): string | null {
  if (!location) return null;
  const city = location.split(',')[0]?.trim();
  return city || null;
}

// Calendar-day difference (midnight-to-midnight), not raw elapsed hours —
// something that happened late yesterday and is viewed early this morning is
// only a few real hours ago, but should read as "yesterday"/"1d ago", not
// "today", and should flip over at the next local midnight/refresh rather
// than only after a full 24h have actually elapsed.
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
}

export function formatPostedAgo(dateStr: string | null | undefined): string | null {
  const days = daysSince(dateStr);
  if (days === null) return null;
  if (days < 1) return 'Posted today';
  if (days < 7) return `Posted ${days}d ago`;
  return `Posted ${Math.floor(days / 7)}w ago`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
