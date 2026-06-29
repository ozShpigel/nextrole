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
