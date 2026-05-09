export type DiscoveryStatus = 'pending' | 'scraping' | 'scoring' | 'completed' | 'failed';

export type StatusClass = 'status-green' | 'status-red' | 'status-yellow' | 'status-dim';

export const STATUS_LABEL: Record<DiscoveryStatus, string> = {
  pending: 'Pending',
  scraping: 'Scraping',
  scoring: 'Scoring',
  completed: 'Completed',
  failed: 'Failed',
};

export function statusClass(status: DiscoveryStatus): StatusClass {
  if (status === 'completed') return 'status-green';
  if (status === 'failed') return 'status-red';
  if (status === 'scraping' || status === 'scoring') return 'status-yellow';
  return 'status-dim';
}

export const statusDotColors: Record<StatusClass, string> = {
  'status-green': 'bg-emerald-600',
  'status-red': 'bg-red-500',
  'status-yellow': 'bg-amber-600 animate-pulse',
  'status-dim': 'bg-muted-foreground',
};

export const statusBadgeColors: Record<StatusClass, string> = {
  'status-green': 'bg-emerald-50 text-emerald-600 border-emerald-600/18',
  'status-red': 'bg-red-50 text-red-500 border-red-500/18',
  'status-yellow': 'bg-amber-50 text-amber-600 border-amber-600/18',
  'status-dim': 'bg-muted/50 text-muted-foreground border-border',
};
