import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, RefreshCw, ExternalLink, X } from 'lucide-react';
import { useApplications, useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';
import { useGeneratePack, useUpdateAppStatus, useDeleteApplication } from '../lib/mutations';
import { verdictLabel, formatDate, formatTime } from '../lib/format';
import ConfirmDialog from '../components/ConfirmDialog';
import { CompanyAvatar } from '../components/CompanyAvatar';
import { StatusBadge } from '../components/Status';

interface Application {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  matchScore: number | null;
  matchVerdict: string | null;
  jobUrl: string | null;
  companyLogo?: string | null;
  createdAt: string;
  updatedAt?: string;
  hasPack?: boolean;
  nextInterviewAt?: string | null;
  nextInterviewEndsAt?: string | null;
  nextInterviewer?: string | null;
  appliedAt?: string | null;
}

// Live interview stages — same grouping ApplicationList.tsx's feature cards
// use ("IN_MOTION"), just under a different name here since this column
// isn't about motion/stillness, it's "still going, not resolved yet".
const IN_PROCESS_STATUSES = new Set(['PhoneScreen', 'TechnicalInterview', 'FinalRound', 'OfferReceived', 'Accepted']);

// An Applied card silent this long reads as gone-cold — muted rather than
// hidden, same "still there but fading" treatment ApplicationList.tsx uses
// for its own ghosted rows (just a shorter window: this board is about
// what's still worth acting on, not a full ghosting archive).
const APPLIED_STALE_DAYS = 14;

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Editorial verdict tint — same mapping as ApplicationList.tsx's local copy
// (var(--ed-*), not the emerald/red of lib/format).
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

const TODAY = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

const ED_BTN = 'rounded-full border px-4 py-[0.55rem] text-[0.7rem] font-semibold uppercase tracking-[0.1em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;

function Card({ app, index, muted, children }: { app: Application; index: number; muted?: boolean; children: ReactNode }) {
  return (
    <article
      className={`ed-rise flex flex-col gap-3 border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 p-5 transition-colors hover:border-[var(--ed-ink-faint)] ${muted ? 'opacity-55 hover:opacity-90 transition-opacity' : ''}`}
      style={{ animationDelay: `${Math.min(index, 10) * 60}ms` }}
    >
      <div className="flex items-start gap-3">
        <CompanyAvatar name={app.company} logo={app.companyLogo} size={36} />
        <div className="min-w-0">
          <span className="text-[0.78rem] font-bold text-[var(--ed-accent)]">{app.company}</span>
          <h3 className="ed-display font-semibold text-[0.95rem] leading-[1.3] text-[var(--ed-ink)] mt-1 line-clamp-2">{app.jobTitle}</h3>
        </div>
      </div>
      {app.matchVerdict && (
        <span className="text-[0.7rem]" style={{ color: edVerdictColor(app.matchVerdict) }}>
          {verdictLabel(app.matchVerdict)}{app.matchScore != null && <span className="tabular-nums"> ({app.matchScore})</span>}
        </span>
      )}
      <div className="mt-auto flex gap-2 items-center flex-wrap pt-1">{children}</div>
    </article>
  );
}

function Column(
  { label, count, isEmpty, emptyText, children }:
  { label: string; count: number; isEmpty?: boolean; emptyText: string; children: ReactNode },
) {
  return (
    <div>
      <div className="flex items-baseline gap-[0.6rem] border-b border-[var(--ed-rule)] pb-[0.5rem] mb-5">
        <span className="text-[0.66rem] uppercase tracking-[0.24em] font-semibold text-[var(--ed-ink-faint)]">{label}</span>
        <span className="text-[0.66rem] text-[var(--ed-ink-faint)]/70 tabular-nums">· {count}</span>
      </div>
      <div className="flex flex-col gap-4">
        {(isEmpty ?? count === 0) ? (
          <div className="border border-dashed border-[var(--ed-rule)] p-6">
            <p className="text-center text-[0.8rem] text-[var(--ed-ink-faint)] italic">{emptyText}</p>
          </div>
        ) : children}
      </div>
    </div>
  );
}

function AppliedCard({ app, index, muted }: { app: Application; index: number; muted?: boolean }) {
  const days = daysSince(app.appliedAt ?? app.updatedAt ?? app.createdAt);
  return (
    <Card app={app} index={index} muted={muted}>
      {days !== null && (
        <span className="text-[0.66rem] tabular-nums" style={{ color: 'var(--ed-ink-faint)' }}>
          Applied {days === 0 ? 'today' : `${days}d ago`}
        </span>
      )}
      {app.jobUrl ? (
        <a
          href={app.jobUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${ED_GHOST} text-[0.64rem] px-3 py-[0.45rem] ml-auto inline-flex items-center gap-[0.35rem]`}
        >
          <ExternalLink size={12} aria-hidden="true" />
          View Job
        </a>
      ) : (
        <button type="button" disabled title="Job link unavailable" className={`${ED_GHOST} text-[0.64rem] px-3 py-[0.45rem] ml-auto`}>
          View Job
        </button>
      )}
    </Card>
  );
}

export default function ActivePage() {
  const navigate = useNavigate();
  const { data: apps = [], isLoading, error } = useApplications();
  const demoMode = useDemoMode();
  const generatePack = useGeneratePack();
  const updateStatus = useUpdateAppStatus();
  const deleteApp = useDeleteApplication();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; jobUrl: string | null } | null>(null);

  const { added, ready, appliedFresh, appliedStale, inProcess } = useMemo(() => {
    const all = apps as Application[];
    const byFreshest = (x: Application, y: Application) =>
      new Date(y.updatedAt ?? y.createdAt).getTime() - new Date(x.updatedAt ?? x.createdAt).getTime();
    const applied = all.filter((a) => a.status === 'Applied').sort(byFreshest);
    const isStale = (a: Application) => {
      const days = daysSince(a.appliedAt ?? a.updatedAt ?? a.createdAt);
      return days !== null && days > APPLIED_STALE_DAYS;
    };
    return {
      added: all.filter((a) => a.status === 'DecidedToApply' && !a.hasPack).sort(byFreshest),
      ready: all.filter((a) => a.status === 'DecidedToApply' && a.hasPack).sort(byFreshest),
      appliedFresh: applied.filter((a) => !isStale(a)),
      appliedStale: applied.filter(isStale),
      inProcess: all.filter((a) => IN_PROCESS_STATUSES.has(a.status)).sort(byFreshest),
    };
  }, [apps]);

  function markApplied(appId: string): void {
    updateStatus.mutate({ appId, newStatus: 'Applied' });
  }

  function IAppliedLink({ appId }: { appId: string }) {
    return (
      <button
        type="button"
        disabled={demoMode}
        title={demoMode ? DEMO_DISABLED_TITLE : undefined}
        className="text-[0.64rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] transition-colors disabled:opacity-50 disabled:pointer-events-none"
        onClick={() => markApplied(appId)}
      >
        I applied &rarr;
      </button>
    );
  }

  function RemoveButton({ appId, company, jobUrl }: { appId: string; company: string; jobUrl: string | null }) {
    return (
      <button
        type="button"
        disabled={demoMode}
        title={demoMode ? DEMO_DISABLED_TITLE : 'Remove'}
        aria-label={`Remove application at ${company}`}
        className="ml-auto w-6 h-6 flex items-center justify-center text-[var(--ed-ink-faint)] hover:text-[var(--ed-no)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        onClick={() => setDeleteTarget({ id: appId, jobUrl })}
      >
        <X size={13} aria-hidden="true" />
      </button>
    );
  }

  if (error) {
    return (
      <div className="editorial min-h-[calc(100vh-56px)] flex items-center justify-center p-8">
        <p className="text-[var(--ed-no)] text-[0.88rem]">Failed to load: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="relative z-[1] max-w-[1100px] mx-auto px-8 pt-12 pb-16 max-[640px]:px-5 max-[640px]:pt-8">
        <header className="mb-9">
          <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
            <span>Active</span>
            <span className="tabular-nums">{TODAY}</span>
          </div>
          <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">
            Active
          </h1>
          <div className="mt-5 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
        </header>

        {isLoading ? (
          <p className="text-center text-[var(--ed-ink-faint)] py-12 text-[0.88rem]">Loading&hellip;</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
            <Column label="Added" count={added.length} emptyText="Nothing here yet — add a job from Matches.">
              {added.map((a, i) => (
                <Card key={a.id} app={a} index={i}>
                  <button
                    type="button"
                    disabled={demoMode || (generatePack.isPending && generatePack.variables === a.id)}
                    title={demoMode ? DEMO_DISABLED_TITLE : undefined}
                    className={`${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)] text-[0.64rem] px-3 py-[0.45rem] inline-flex items-center gap-[0.35rem]`}
                    onClick={() => generatePack.mutate(a.id)}
                  >
                    {generatePack.isPending && generatePack.variables === a.id
                      ? <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                      : <Sparkles size={12} aria-hidden="true" />}
                    Generate Pack
                  </button>
                  <IAppliedLink appId={a.id} />
                  <RemoveButton appId={a.id} company={a.company} jobUrl={a.jobUrl} />
                </Card>
              ))}
            </Column>

            <Column label="Ready" count={ready.length} emptyText="Generate a pack from Added to see it here.">
              {ready.map((a, i) => (
                <Card key={a.id} app={a} index={i}>
                  <button type="button" className={`${ED_GHOST} text-[0.64rem] px-3 py-[0.45rem]`} onClick={() => navigate(`/tracker/${a.id}/pack`)}>
                    Review
                  </button>
                  <button
                    type="button"
                    disabled={demoMode || (generatePack.isPending && generatePack.variables === a.id)}
                    title={demoMode ? DEMO_DISABLED_TITLE : 'Regenerate the résumé pack'}
                    aria-label={`Regenerate résumé pack for ${a.company}`}
                    className={`${ED_GHOST} text-[0.64rem] px-3 py-[0.45rem] inline-flex items-center gap-[0.35rem]`}
                    onClick={() => generatePack.mutate(a.id)}
                  >
                    <RefreshCw size={12} className={generatePack.isPending && generatePack.variables === a.id ? 'animate-spin' : ''} aria-hidden="true" />
                    Regenerate
                  </button>
                  <IAppliedLink appId={a.id} />
                  <RemoveButton appId={a.id} company={a.company} jobUrl={a.jobUrl} />
                </Card>
              ))}
            </Column>

            <Column label="Applied" count={appliedFresh.length} isEmpty={appliedFresh.length === 0 && appliedStale.length === 0} emptyText="Nothing applied yet.">
              {appliedFresh.map((a, i) => <AppliedCard key={a.id} app={a} index={i} />)}
              {appliedStale.length > 0 && (
                <details className="mt-1 group">
                  <summary className="cursor-pointer list-none inline-flex items-baseline gap-[0.6rem] py-[0.4rem] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-soft)] transition-colors">
                    <span aria-hidden="true" className="text-[0.8rem] leading-none transition-transform group-open:rotate-90">▸</span>
                    <span className="text-[0.62rem] uppercase tracking-[0.22em] font-semibold">Older</span>
                    <span className="text-[0.62rem] text-[var(--ed-ink-faint)]/70 tabular-nums">· {appliedStale.length} silent {APPLIED_STALE_DAYS}d+</span>
                  </summary>
                  <div className="flex flex-col gap-4 border-t border-[var(--ed-rule)] pt-4 mt-1">
                    {appliedStale.map((a, i) => <AppliedCard key={a.id} app={a} index={i} muted />)}
                  </div>
                </details>
              )}
            </Column>

            <Column label="In Process" count={inProcess.length} emptyText="No live interview processes right now.">
              {inProcess.map((a, i) => (
                <Card key={a.id} app={a} index={i}>
                  <StatusBadge status={a.status} />
                  {a.nextInterviewAt && (
                    <span className="text-[0.68rem] text-[var(--ed-ink-soft)] tabular-nums">
                      {formatDate(a.nextInterviewAt)} · {formatTime(a.nextInterviewAt)}
                      {a.nextInterviewEndsAt && `–${formatTime(a.nextInterviewEndsAt)}`}
                      {a.nextInterviewer && ` — ${a.nextInterviewer}`}
                    </span>
                  )}
                  {a.jobUrl && (
                    <a
                      href={a.jobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${ED_GHOST} text-[0.64rem] px-3 py-[0.45rem] ml-auto inline-flex items-center gap-[0.35rem]`}
                    >
                      <ExternalLink size={12} aria-hidden="true" />
                      View Job
                    </a>
                  )}
                </Card>
              ))}
            </Column>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        description="Remove this application? All interviews and notes will also be deleted."
        onConfirm={() => {
          if (deleteTarget) deleteApp.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
