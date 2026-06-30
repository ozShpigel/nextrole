export type DiscoveryStatus = 'pending' | 'scraping' | 'scoring' | 'completed' | 'failed' | 'cancelled';

export type StatusClass = 'status-green' | 'status-red' | 'status-yellow' | 'status-dim';

export const STATUS_LABEL: Record<DiscoveryStatus, string> = {
  pending: 'Pending',
  scraping: 'Scraping',
  scoring: 'Scoring',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function statusClass(status: DiscoveryStatus): StatusClass {
  if (status === 'completed') return 'status-green';
  if (status === 'failed') return 'status-red';
  if (status === 'scraping' || status === 'scoring') return 'status-yellow';
  return 'status-dim'; // pending + cancelled → neutral grey (cancel isn't an error)
}

// Editorial run-status tones (light/dark adaptive). Shared by the dot, the
// stamp badge, and its left tone-bar so the Search History matches the rest of
// the broadsheet: sage = done · oxblood = failed · ochre = in-flight.
export const statusTone: Record<StatusClass, string> = {
  'status-green': 'var(--ed-yes)',
  'status-red': 'var(--ed-no)',
  'status-yellow': 'var(--ed-gold)',
  'status-dim': 'var(--ed-ink-faint)',
};

export const statusDotColors: Record<StatusClass, string> = {
  'status-green': 'bg-[var(--ed-yes)]',
  'status-red': 'bg-[var(--ed-no)]',
  'status-yellow': 'bg-[var(--ed-gold)] animate-pulse',
  'status-dim': 'bg-[var(--ed-ink-faint)]',
};

export const statusBadgeColors: Record<StatusClass, string> = {
  'status-green': 'bg-[var(--ed-yes)]/10 text-[var(--ed-yes)] border-[var(--ed-yes)]/30',
  'status-red': 'bg-[var(--ed-no)]/10 text-[var(--ed-no)] border-[var(--ed-no)]/30',
  'status-yellow': 'bg-[var(--ed-gold)]/12 text-[var(--ed-gold)] border-[var(--ed-gold)]/30',
  'status-dim': 'bg-[var(--ed-panel)] text-[var(--ed-ink-faint)] border-[var(--ed-rule)]',
};
