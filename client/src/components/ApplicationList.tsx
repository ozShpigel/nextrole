import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, FileCheck, RefreshCw } from 'lucide-react';
import { useApplications, useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';
import { useDeleteApplication, useGeneratePack } from '../lib/mutations';
import { formatDate, formatTime, verdictLabel, daysSince } from '../lib/format';
import { edVerdictColor } from './AnalysisCard';
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
  jobUrl?: string | null;
  createdAt: string;
  updatedAt?: string;
  nextInterviewAt?: string | null;
  nextInterviewEndsAt?: string | null;
  nextInterviewer?: string | null;
  hasPack?: boolean;
  packGeneratedAt?: string | null;
}

// The page reads as a front page: live interview processes get feature cards,
// the user's own to-apply queue and applications awaiting a reply stay compact
// rows, stale waits fold into "Probably ghosted", closed ones fold away.
const IN_MOTION = new Set(['PhoneScreen', 'TechnicalInterview', 'FinalRound', 'OfferReceived', 'Accepted']);
const CLOSED = new Set(['Rejected', 'Withdrawn']);
// Not waiting on anyone — these are the user's own next moves.
const TO_APPLY = new Set(['Analyzing', 'DecidedToApply']);
// An Applied role silent this long is presumed ghosted (presentation only).
const GHOST_DAYS = 30;
// Fresh awaiting rows shown before the "Show all" expander.
const AWAITING_VISIBLE = 6;

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

const COLS = 'grid-cols-[1fr_1fr] md:grid-cols-[2fr_1.3fr_1fr_0.5fr_4rem_0.8fr_4.5rem]';
const HEAD = 'hidden md:grid grid-cols-[2fr_1.3fr_1fr_0.5fr_4rem_0.8fr_4.5rem] gap-4 py-[0.6rem] text-[13px] text-[var(--ed-ink-faint)] border-b border-[var(--ed-rule)] uppercase tracking-[0.1em] font-medium';

function TableHead() {
  return (
    <div className={HEAD}>
      <span>Position</span>
      <span>Company</span>
      <span>Status</span>
      <span>Days</span>
      <span>Score</span>
      <span>Date</span>
      <span></span>
    </div>
  );
}

// Quiet running-head, same voice as the page dateline — a whisper, not a rule.
function SectionRule({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-[0.6rem] border-b border-[var(--ed-rule)] pb-[0.5rem] mb-5">
      <span className="text-[13px] uppercase tracking-[0.16em] font-medium text-[var(--ed-ink-faint)]">{label}</span>
      <span className="text-[13px] text-[var(--ed-ink-faint)]/70 tabular-nums">· {count}</span>
    </div>
  );
}

function FeatureCard({ app, index, onOpen }: { app: Application; index: number; onOpen: () => void }) {
  const days = daysSince(app.updatedAt);
  const tone = edVerdictColor(app.matchVerdict);
  return (
    <article
      className="ed-rise border-b border-[var(--ed-rule)] py-4 cursor-pointer transition-colors hover:bg-[var(--ed-panel)]/50"
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={onOpen}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-[0.15rem]">
            <span className="text-[13px] text-[var(--ed-ink-faint)] uppercase tracking-[0.06em]">{app.company}</span>
            <StatusBadge status={app.status} />
          </div>
          <h3 className="text-[16px] font-medium leading-[1.3] text-[var(--ed-ink)]">{app.jobTitle}</h3>
          <div className="mt-2 text-[13px] leading-relaxed">
            {app.nextInterviewAt ? (
              <span className="text-[var(--ed-ink-soft)]">
                {interviewDayLabel(app.nextInterviewAt)}, {formatTime(app.nextInterviewAt)}{app.nextInterviewEndsAt ? `–${formatTime(app.nextInterviewEndsAt)}` : ''}
                {app.nextInterviewer && ` — with ${app.nextInterviewer}`}
              </span>
            ) : (
              <span className="italic text-[var(--ed-ink-faint)]">No interview on the calendar</span>
            )}
          </div>
        </div>
        {app.matchScore != null && (
          <div className="shrink-0 text-right">
            <div className="text-[40px] font-medium leading-none tabular-nums" style={{ color: tone }}>{app.matchScore}</div>
            <div className="text-[13px] text-[var(--ed-ink-faint)] uppercase tracking-[0.04em]">{verdictLabel(app.matchVerdict)}</div>
          </div>
        )}
      </div>
      <div className="mt-2 text-[13px] text-[var(--ed-ink-faint)] tabular-nums">
        {days !== null ? `updated ${days === 0 ? 'today' : `${days}d ago`}` : ''}
      </div>
    </article>
  );
}

interface RowProps {
  app: Application;
  index?: number;
  muted?: boolean;
  onOpen: () => void;
  onDelete: () => void;
  // Only passed from the "To Apply" section — Generate/Review Pack makes
  // sense before you've applied, not for rows already sent or archived.
  onGeneratePack?: () => void;
  onReviewPack?: () => void;
  packGenerating?: boolean;
  demoMode?: boolean;
}

function Row({ app, index = 0, muted, onOpen, onDelete, onGeneratePack, onReviewPack, packGenerating, demoMode }: RowProps) {
  const days = daysSince(app.updatedAt);
  const showPackAction = !!(onGeneratePack || onReviewPack);
  const tone = edVerdictColor(app.matchVerdict);
  return (
    <div
      className={`ed-rise group grid ${COLS} items-center gap-4 py-3 border-b border-[var(--ed-rule)]/70 cursor-pointer transition-colors duration-300 hover:bg-[var(--ed-panel)]/50 last:border-b-0 ${muted ? 'opacity-65 hover:opacity-90 transition-opacity' : ''}`}
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
      onClick={onOpen}
    >
      <div className="font-medium text-[var(--ed-ink)] text-[16px] truncate">{app.jobTitle}</div>
      <div className="text-[var(--ed-ink-soft)] text-[13px] truncate">{app.company}</div>
      <div><StatusBadge status={app.status} /></div>
      <div className="text-[13px] text-[var(--ed-ink-faint)] tabular-nums" title={days !== null ? `${days} day${days === 1 ? '' : 's'} since last update` : 'No update recorded'}>{days !== null ? `${days}d` : '-'}</div>
      <div className="flex flex-col items-start gap-0">
        <span className="text-[40px] font-medium leading-none tabular-nums" style={{ color: tone }}>{app.matchScore ?? '—'}</span>
        <span className="text-[13px] text-[var(--ed-ink-faint)] uppercase tracking-[0.04em]">{verdictLabel(app.matchVerdict)}</span>
      </div>
      <div className="text-[var(--ed-ink-faint)] text-[13px] tabular-nums" title="Last updated">
        {formatDate(app.updatedAt ?? app.createdAt)}
      </div>
      <div className="justify-self-end flex items-center gap-1">
        {showPackAction && (
          <button
            type="button"
            aria-label={app.hasPack ? `Review résumé pack for ${app.company}` : `Generate résumé pack for ${app.company}`}
            title={demoMode && !app.hasPack ? DEMO_DISABLED_TITLE : (app.hasPack ? 'Review Pack' : 'Generate Pack')}
            disabled={packGenerating || (demoMode && !app.hasPack)}
            className="w-7 h-7 flex items-center justify-center text-[var(--ed-ink-faint)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200 hover:text-[var(--ed-accent)] disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              if (app.hasPack) onReviewPack?.();
              else onGeneratePack?.();
            }}
          >
            {packGenerating ? <RefreshCw size={14} className="animate-spin" /> : app.hasPack ? <FileCheck size={14} /> : <Sparkles size={14} />}
          </button>
        )}
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
  const generatePackMutation = useGeneratePack();
  const demoMode = useDemoMode();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; jobUrl: string | null } | null>(null);
  const [showAllAwaiting, setShowAllAwaiting] = useState(false);

  if (error) {
    return <div className="border border-[var(--ed-no)]/30 bg-[var(--ed-no)]/10 p-6 mb-4"><p className="text-center py-12 text-[var(--ed-no)] text-[16px]">Failed to load applications: {error.message}</p></div>;
  }

  // While the initial fetch is in flight (slow on a cold API), show skeleton
  // rows instead of the empty state — otherwise "No applications yet" flashes
  // even when applications exist.
  if (isLoading) {
    return (
      <div className="mb-4" aria-hidden="true">
        <TableHead />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`grid ${COLS} items-center gap-4 py-3 border-b border-[var(--ed-rule)] last:border-b-0`}>
            <Skeleton className="h-[16px] w-[80%] rounded" />
            <Skeleton className="h-[13px] w-[60%] rounded" />
            <Skeleton className="h-[20px] w-[72px] rounded-full" />
            <Skeleton className="h-[13px] w-[28px] rounded" />
            <Skeleton className="h-[40px] w-[3rem] rounded" />
            <Skeleton className="h-[13px] w-[64px] rounded" />
            <Skeleton className="h-[20px] w-[20px] rounded justify-self-end" />
          </div>
        ))}
        <span className="sr-only">Loading applications</span>
      </div>
    );
  }

  if (apps.length === 0) {
    return <div className="border border-dashed border-[var(--ed-rule)] p-6 mb-4"><p className="ed-display italic text-center py-12 text-[var(--ed-ink-faint)] text-[16px]">No applications yet. Add a new application!</p></div>;
  }

  const all = apps as Application[];
  const lastTouch = (x: Application) => new Date(x.updatedAt ?? x.createdAt).getTime();
  const byFreshest = (a: Application, b: Application) => lastTouch(b) - lastTouch(a);

  const inMotion = all
    .filter((a) => IN_MOTION.has(a.status))
    .sort((a, b) => {
      // Soonest upcoming interview first; no-interview cards last.
      const t = (x: Application) => (x.nextInterviewAt ? new Date(x.nextInterviewAt).getTime() : Infinity);
      return t(a) - t(b);
    });
  const toApply = all.filter((a) => TO_APPLY.has(a.status)).sort(byFreshest);
  // Everything else (Applied + any unknown/legacy status) waits on a reply —
  // the catch-all keeps nothing from silently disappearing off the page.
  const appliedAll = all
    .filter((a) => !IN_MOTION.has(a.status) && !CLOSED.has(a.status) && !TO_APPLY.has(a.status))
    .sort(byFreshest);
  const awaiting = appliedAll.filter((a) => (daysSince(a.updatedAt ?? a.createdAt) ?? 0) < GHOST_DAYS);
  const ghosted = appliedAll.filter((a) => (daysSince(a.updatedAt ?? a.createdAt) ?? 0) >= GHOST_DAYS);
  const awaitingVisible = showAllAwaiting ? awaiting : awaiting.slice(0, AWAITING_VISIBLE);
  const archive = all
    .filter((a) => CLOSED.has(a.status))
    .sort(byFreshest);

  const open = (id: string) => navigate(`/tracker/${id}`);

  return (
    <>
    <div className="mb-4">
      {/* Live processes — the front page */}
      <section aria-label="Applications in motion">
        <SectionRule label="In Motion" count={inMotion.length} />
        {inMotion.length > 0 ? (
          <div>
            {inMotion.map((a, i) => <FeatureCard key={a.id} app={a} index={i} onOpen={() => open(a.id)} />)}
          </div>
        ) : (
          <p className="ed-display italic text-[16px] text-[var(--ed-ink-faint)] py-2">Nothing in motion yet — the applications below are waiting on a reply.</p>
        )}
      </section>

      {/* The user's own queue — nothing sent yet, nothing to wait on */}
      {toApply.length > 0 && (
        <section aria-label="Applications to apply to" className="mt-12">
          <SectionRule label="To Apply" count={toApply.length} />
          <TableHead />
          {toApply.map((a, i) => (
            <Row
              key={a.id}
              app={a}
              index={i}
              onOpen={() => open(a.id)}
              onDelete={() => setDeleteTarget({ id: a.id, jobUrl: a.jobUrl ?? null })}
              onGeneratePack={() => generatePackMutation.mutate(a.id)}
              onReviewPack={() => navigate(`/tracker/${a.id}/pack`)}
              packGenerating={generatePackMutation.isPending && generatePackMutation.variables === a.id}
              demoMode={demoMode}
            />
          ))}
        </section>
      )}

      {/* Sent, no verdict yet — capped, with the long silences folded away */}
      {appliedAll.length > 0 && (
        <section aria-label="Applications awaiting a reply" className="mt-12">
          <SectionRule label="No Reply Yet" count={awaiting.length} />
          {awaiting.length > 0 && (
            <>
              <TableHead />
              {awaitingVisible.map((a, i) => <Row key={a.id} app={a} index={i} onOpen={() => open(a.id)} onDelete={() => setDeleteTarget({ id: a.id, jobUrl: a.jobUrl ?? null })} />)}
              {awaiting.length > AWAITING_VISIBLE && (
                <button
                  type="button"
                  onClick={() => setShowAllAwaiting((v) => !v)}
                  className="w-full py-[0.6rem] text-[13px] uppercase tracking-[0.1em] font-medium text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] transition-colors border-b border-[var(--ed-rule)]/70"
                >
                  {showAllAwaiting ? 'Show fewer' : `Show all (${awaiting.length})`}
                </button>
              )}
            </>
          )}
          {ghosted.length > 0 && (
            <details className="mt-3 group">
              <summary className="cursor-pointer list-none inline-flex items-baseline gap-[0.6rem] py-[0.5rem] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-soft)] transition-colors">
                <span aria-hidden="true" className="text-[13px] leading-none transition-transform group-open:rotate-90">▸</span>
                <span className="text-[13px] uppercase tracking-[0.16em] font-medium">Probably ghosted</span>
                <span className="text-[13px] text-[var(--ed-ink-faint)]/70 tabular-nums">· {ghosted.length} silent {GHOST_DAYS}d+</span>
              </summary>
              <div className="border-t border-[var(--ed-rule)] pt-1">
                {ghosted.map((a, i) => <Row key={a.id} app={a} index={i} muted onOpen={() => open(a.id)} onDelete={() => setDeleteTarget({ id: a.id, jobUrl: a.jobUrl ?? null })} />)}
              </div>
            </details>
          )}
        </section>
      )}

      {/* Closed processes — folded away, one line of presence */}
      {archive.length > 0 && (
        <details className="mt-12 group">
          <summary className="cursor-pointer list-none inline-flex items-baseline gap-[0.6rem] pb-[0.5rem] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-soft)] transition-colors">
            <span aria-hidden="true" className="text-[13px] leading-none transition-transform group-open:rotate-90">▸</span>
            <span className="text-[13px] uppercase tracking-[0.16em] font-medium">The Archive</span>
            <span className="text-[13px] text-[var(--ed-ink-faint)]/70 tabular-nums">· {archive.length} closed</span>
          </summary>
          <div className="border-t border-[var(--ed-rule)] pt-1">
            {archive.map((a, i) => <Row key={a.id} app={a} index={i} muted onOpen={() => open(a.id)} onDelete={() => setDeleteTarget({ id: a.id, jobUrl: a.jobUrl ?? null })} />)}
          </div>
        </details>
      )}
    </div>

    <ConfirmDialog
      open={!!deleteTarget}
      description="Delete this application? All interviews and notes will also be deleted."
      onConfirm={() => {
        if (deleteTarget) deleteAppMutation.mutate(deleteTarget);
        setDeleteTarget(null);
      }}
      onCancel={() => setDeleteTarget(null)}
    />
    </>
  );
}
