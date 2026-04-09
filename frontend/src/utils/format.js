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

export function scoreColor(score) {
  if (score == null) return 'var(--text-dim)';
  if (score >= 60) return 'var(--green)';
  if (score >= 40) return 'var(--yellow)';
  return 'var(--red)';
}

export function barColor(score, max) {
  if (score == null || max == null || max === 0) return 'red';
  const pct = score / max;
  if (pct >= 0.6) return 'green';
  if (pct >= 0.4) return 'yellow';
  return 'red';
}
