import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApplications } from '../lib/queries';
import { useDeleteApplication } from '../lib/mutations';
import { formatDate, formatTime, verdictLabel } from '../lib/format';
import { StatusBadge, STATUS_TONE } from './Status';
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
  nextInterviewAt?: string | null;
  nextInterviewEndsAt?: string | null;
  nextInterviewer?: string | null;
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

// The page reads as a front page: live interview processes get feature cards,
// applications awaiting a reply stay compact rows, closed ones fold away.
const IN_MOTION = new Set(['PhoneScreen', 'TechnicalInterview', 'FinalRound', 'OfferReceived', 'Accepted']);
const CLOSED = new Set(['Rejected', 'Withdrawn']);

// "Today" / "Tomorrow" / weekday within a week / date — for the feature cards.
function interviewDayLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return formatDate(iso);
}

function daysSince(iso: string | undefined): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;
}

const COLS = 'grid-cols-[1fr_1fr] md:grid-cols-[2fr_1.5fr_1fr_0.5fr_0.8fr_0.5fr_2.25rem]';
const HEAD = 'hidden md:grid grid-cols-[2fr_1.5fr_1fr_0.5fr_0.8fr_0.5fr_2.25rem] gap-4 py-[0.6rem] text-[0.62rem] text-[var(--ed-ink-faint)] border-b border-[var(--ed-rule)] uppercase tracking-[0.14em] font-semibold';

// Quiet running-head, same voice as the page dateline — a whisper, not a rule.
function SectionRule({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-[0.6rem] border-b border-[var(--ed-rule)] pb-[0.5rem] mb-5">
      <span className="text-[0.66rem] uppercase tracking-[0.24em] font-semibold text-[var(--ed-ink-faint)]">{label}</span>
      <span className="text-[0.66rem] text-[var(--ed-ink-faint)]/70 tabular-nums">· {count}</span>
    </div>
  );
}

function FeatureCard({ app, index, onOpen }: { app: Application; index: number; onOpen: () => void }) {
  const tone = STATUS_TONE[app.status] ?? 'var(--ed-ink-soft)';
  const days = daysSince(app.updatedAt);
  return (
    <article
      className="ed-rise relative bg-[var(--ed-panel)]/35 border border-[var(--ed-rule)] pl-6 pr-5 py-5 cursor-pointer transition-all duration-300 hover:bg-[var(--ed-panel)]/60 hover:border-[var(--ed-rule-strong)]"
      style={{ animationDelay: `${index * 90}ms` }}
      onClick={onOpen}
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-4 bottom-4 w-[2px]"
        style={{ background: `color-mix(in oklab, ${tone} 55%, transparent)` }}
      />
      <div className="flex items-start justify-between gap-3">
        <span className="text-[0.64rem] uppercase tracking-[0.18em] font-medium text-[var(--ed-ink-faint)]">{app.company}</span>
        <StatusBadge status={app.status} />
      </div>
      <h3 className="ed-display font-semibold text-[1.08rem] leading-[1.3] text-[var(--ed-ink)] mt-2">{app.jobTitle}</h3>
      <div className="mt-4 text-[0.84rem] leading-relaxed">
        {app.nextInterviewAt ? (
          <div className="text-[var(--ed-ink-soft)]">
            <span aria-hidden="true" className="text-[var(--ed-accent)] text-[0.6rem] align-middle mr-2">◆</span>
            <span className="ed-display italic text-[var(--ed-ink)]">{interviewDayLabel(app.nextInterviewAt)}</span>
            <span className="tabular-nums">, {formatTime(app.nextInterviewAt)}{app.nextInterviewEndsAt ? `–${formatTime(app.nextInterviewEndsAt)}` : ''}</span>
            {app.nextInterviewer && <span> — with {app.nextInterviewer}</span>}
          </div>
        ) : (
          <div className="italic text-[var(--ed-ink-faint)]">No interview on the calendar</div>
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--ed-rule)]/60 flex items-baseline justify-between text-[0.7rem] text-[var(--ed-ink-faint)]">
        <span>
          {app.matchVerdict ? (
            <>Fit: <span style={{ color: edVerdictColor(app.matchVerdict) }}>{verdictLabel(app.matchVerdict)}</span>{app.matchScore != null && <span className="tabular-nums"> ({app.matchScore})</span>}</>
          ) : ''}
        </span>
        <span className="tabular-nums">{days !== null ? `updated ${days === 0 ? 'today' : `${days}d ago`}` : ''}</span>
      </div>
    </article>
  );
}

function Row({ app, muted, onOpen, onDelete }: { app: Application; muted?: boolean; onOpen: () => void; onDelete: () => void }) {
  const days = daysSince(app.updatedAt);
  // Stay quiet unless the silence is getting long.
  const daysColor = days !== null && days >= 14 ? 'var(--ed-no)' : days !== null && days >= 7 ? 'var(--ed-gold)' : 'var(--ed-ink-faint)';
  return (
    <div
      className={`group grid ${COLS} items-center gap-4 py-[1.05rem] border-b border-[var(--ed-rule)]/70 cursor-pointer transition-colors duration-300 hover:bg-[var(--ed-panel)]/50 last:border-b-0 ${muted ? 'opacity-65 hover:opacity-90 transition-opacity' : ''}`}
      onClick={onOpen}
    >
      <div><div className="ed-display font-medium text-[var(--ed-ink)] text-[0.95rem]">{app.jobTitle}</div></div>
      <div className="text-[var(--ed-ink-soft)] text-[0.84rem]">{app.company}</div>
      <div><StatusBadge status={app.status} /></div>
      <div className="text-[0.78rem] tabular-nums" style={{ color: daysColor }} title={days !== null ? `${days} day${days === 1 ? '' : 's'} since last update` : 'No update recorded'}>{days !== null ? `${days}d` : '-'}</div>
      <div className="ed-display text-[0.85rem]" style={{ color: edVerdictColor(app.matchVerdict) }}>{verdictLabel(app.matchVerdict)}{app.matchScore != null ? <span className="text-[var(--ed-ink-faint)] font-normal text-[0.72rem] ml-1">({app.matchScore})</span> : ''}</div>
      <div className="text-[var(--ed-ink-faint)] text-[0.78rem] tabular-nums" title="Last updated">
        {formatDate(app.updatedAt ?? app.createdAt)}
      </div>
      <div className="justify-self-end">
        <button
          type="button"
          aria-label={`Delete application at ${app.company}`}
          title="Delete"
          className="w-7 h-7 flex items-center justify-center text-[1rem] leading-none text-[var(--ed-ink-faint)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200 hover:text-[var(--ed-no)]"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

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
            <Skeleton className="h-[20px] w-[20px] rounded justify-self-end" />
          </div>
        ))}
        <span className="sr-only">Loading applications</span>
      </div>
    );
  }

  if (apps.length === 0) {
    return <div className="border border-dashed border-[var(--ed-rule)] p-6 mb-4"><p className="text-center py-12 text-[var(--ed-ink-faint)] text-[0.88rem]">No applications yet. Add a new application!</p></div>;
  }

  const all = apps as Application[];
  const inMotion = all
    .filter((a) => IN_MOTION.has(a.status))
    .sort((a, b) => {
      // Soonest upcoming interview first; no-interview cards last.
      const t = (x: Application) => (x.nextInterviewAt ? new Date(x.nextInterviewAt).getTime() : Infinity);
      return t(a) - t(b);
    });
  const awaiting = all
    .filter((a) => !IN_MOTION.has(a.status) && !CLOSED.has(a.status))
    .sort((a, b) => (daysSince(b.updatedAt) ?? -1) - (daysSince(a.updatedAt) ?? -1)); // stalest first — they need the nudge
  const archive = all
    .filter((a) => CLOSED.has(a.status))
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());

  const open = (id: string) => navigate(`/tracker/${id}`);

  return (
    <>
    <div className="mb-4">
      {/* Live processes — the front page */}
      <section aria-label="Applications in motion">
        <SectionRule label="In Motion" count={inMotion.length} />
        {inMotion.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2">
            {inMotion.map((a, i) => <FeatureCard key={a.id} app={a} index={i} onOpen={() => open(a.id)} />)}
          </div>
        ) : (
          <p className="italic text-[0.85rem] text-[var(--ed-ink-faint)] py-2">Nothing in motion yet — the applications below are waiting on a reply.</p>
        )}
      </section>

      {/* Sent, no verdict yet */}
      {awaiting.length > 0 && (
        <section aria-label="Applications awaiting a reply" className="mt-12">
          <SectionRule label="No Reply Yet" count={awaiting.length} />
          <div className={HEAD}>
            <span>Position</span>
            <span>Company</span>
            <span>Status</span>
            <span>Days</span>
            <span>Verdict</span>
            <span>Date</span>
            <span></span>
          </div>
          {awaiting.map((a) => <Row key={a.id} app={a} onOpen={() => open(a.id)} onDelete={() => setDeleteId(a.id)} />)}
        </section>
      )}

      {/* Closed processes — folded away, one line of presence */}
      {archive.length > 0 && (
        <details className="mt-12 group">
          <summary className="cursor-pointer list-none inline-flex items-baseline gap-[0.6rem] pb-[0.5rem] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-soft)] transition-colors">
            <span aria-hidden="true" className="text-[0.8rem] leading-none transition-transform group-open:rotate-90">▸</span>
            <span className="text-[0.66rem] uppercase tracking-[0.24em] font-semibold">The Archive</span>
            <span className="text-[0.66rem] text-[var(--ed-ink-faint)]/70 tabular-nums">· {archive.length} closed</span>
          </summary>
          <div className="border-t border-[var(--ed-rule)] pt-1">
            {archive.map((a) => <Row key={a.id} app={a} muted onOpen={() => open(a.id)} onDelete={() => setDeleteId(a.id)} />)}
          </div>
        </details>
      )}
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
