import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApplications } from '../lib/queries';
import { useDeleteApplication } from '../lib/mutations';
import { formatDate, verdictLabel } from '../lib/format';
import { StatusBadge } from './Status';
import ConfirmDialog from './ConfirmDialog';
import { Skeleton } from '@/components/ui/skeleton';

interface Application {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  matchScore: number | null;
  matchVerdict: string | null;
  createdAt: string;
  updatedAt?: string;
}

// Editorial verdict tint (var(--ed-*) instead of the emerald/red of lib/format)
function edVerdictColor(verdict: string | null): string {
  switch (verdict) {
    case 'STRONG_YES':
    case 'YES': return 'var(--ed-yes)';
    case 'MAYBE': return 'var(--ed-gold)';
    case 'NO':
    case 'STRONG_NO': return 'var(--ed-no)';
    default: return 'var(--ed-ink-faint)';
  }
}

const COLS = 'grid-cols-[1fr_1fr] md:grid-cols-[2fr_1.5fr_1fr_0.5fr_0.8fr_0.5fr_minmax(3.5rem,auto)]';
const HEAD = 'hidden md:grid grid-cols-[2fr_1.5fr_1fr_0.5fr_0.8fr_0.5fr_minmax(3.5rem,auto)] gap-4 py-[0.6rem] text-[0.62rem] text-[var(--ed-ink-faint)] border-b border-[var(--ed-rule-strong)] uppercase tracking-[0.14em] font-semibold';

export default function ApplicationList() {
  const navigate = useNavigate();
  const { data: apps = [], error, isLoading } = useApplications();
  const deleteAppMutation = useDeleteApplication();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (error) {
    return <div className="border border-[var(--ed-no)]/30 bg-[var(--ed-no)]/10 p-6 mb-4"><p className="text-center py-12 text-[var(--ed-no)] text-[0.88rem]">Failed to load applications: {error.message}</p></div>;
  }

  // While the initial fetch is in flight (slow on a cold API), show skeleton
  // rows instead of the empty state — otherwise "No applications yet" flashes
  // even when applications exist.
  if (isLoading) {
    return (
      <div className="mb-4" aria-hidden="true">
        <div className={HEAD}>
          <span>Position</span>
          <span>Company</span>
          <span>Status</span>
          <span>Days</span>
          <span>Verdict</span>
          <span>Date</span>
          <span></span>
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`grid ${COLS} items-center gap-4 py-[0.9rem] border-b border-[var(--ed-rule)] last:border-b-0`}>
            <Skeleton className="h-[14px] w-[80%] rounded" />
            <Skeleton className="h-[12px] w-[60%] rounded" />
            <Skeleton className="h-[20px] w-[72px] rounded-full" />
            <Skeleton className="h-[12px] w-[28px] rounded" />
            <Skeleton className="h-[12px] w-[50%] rounded" />
            <Skeleton className="h-[12px] w-[64px] rounded" />
            <Skeleton className="h-[28px] w-[60px] rounded justify-self-end" />
          </div>
        ))}
        <span className="sr-only">Loading applications</span>
      </div>
    );
  }

  if (apps.length === 0) {
    return <div className="border border-dashed border-[var(--ed-rule)] p-6 mb-4"><p className="text-center py-12 text-[var(--ed-ink-faint)] text-[0.88rem]">No applications yet. Add a new application!</p></div>;
  }

  return (
    <>
    <div className="mb-4">
      <div className={HEAD}>
        <span>Position</span>
        <span>Company</span>
        <span>Status</span>
        <span>Days</span>
        <span>Verdict</span>
        <span>Date</span>
        <span></span>
      </div>
      {[...(apps as Application[])]
        .sort((a, b) => {
          // Active first, then Applied/DecidedToApply, then Rejected at the very end.
          const rank = (s: string) =>
            s === 'Rejected' ? 2 : (s === 'Applied' || s === 'DecidedToApply' ? 1 : 0);
          return rank(a.status) - rank(b.status);
        })
        .map((a) => {
        const days = a.updatedAt ? Math.floor((Date.now() - new Date(a.updatedAt).getTime()) / 86400000) : null;
        const daysColor = days !== null && days >= 14 ? 'var(--ed-no)' : days !== null && days >= 7 ? 'var(--ed-gold)' : 'var(--ed-ink-soft)';
        return (
          <div key={a.id} className={`grid ${COLS} items-center gap-4 py-[0.9rem] border-b border-[var(--ed-rule)] cursor-pointer transition-colors hover:bg-[var(--ed-panel)]/60 last:border-b-0`} onClick={() => navigate(`/tracker/${a.id}`)}>
            <div><div className="ed-display font-semibold text-[var(--ed-ink)] text-[0.95rem]">{a.jobTitle}</div></div>
            <div className="text-[var(--ed-ink-soft)] text-[0.84rem]">{a.company}</div>
            <div><StatusBadge status={a.status} /></div>
            <div className="text-[0.78rem] font-medium tabular-nums" style={{ color: daysColor }}>{days !== null ? `${days}d` : '-'}</div>
            <div className="ed-display font-semibold text-[0.85rem]" style={{ color: edVerdictColor(a.matchVerdict) }}>{verdictLabel(a.matchVerdict)}{a.matchScore != null ? <span className="text-[var(--ed-ink-faint)] font-normal text-[0.72rem] ml-1">({a.matchScore})</span> : ''}</div>
            <div className="text-[var(--ed-ink-faint)] text-[0.78rem] tabular-nums">{formatDate(a.createdAt)}</div>
            <div style={{ justifySelf: 'end' }}>
              <button
                type="button"
                className="rounded-none border border-[var(--ed-rule)] px-3 py-[0.35rem] text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-no)] transition-all hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setDeleteId(a.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>

    <ConfirmDialog
      open={!!deleteId}
      description="Delete this application? All interviews and notes will also be deleted."
      onConfirm={() => {
        if (deleteId) deleteAppMutation.mutate(deleteId);
        setDeleteId(null);
      }}
      onCancel={() => setDeleteId(null)}
    />
    </>
  );
}
