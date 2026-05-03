export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return `${formatDate(dateStr)} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function scoreColor(score, max) {
  if (score == null) return 'var(--muted-foreground)';
  const pct = max != null && max > 0 ? score / max : score / 100;
  if (pct >= 0.6) return 'var(--color-green)';
  if (pct >= 0.4) return 'var(--color-yellow)';
  return 'var(--color-red)';
}

export function barColor(score, max) {
  if (score == null || max == null || max === 0) return 'red';
  const pct = score / max;
  if (pct >= 0.6) return 'green';
  if (pct >= 0.4) return 'yellow';
  return 'red';
}

export function relativeTime(iso) {
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
