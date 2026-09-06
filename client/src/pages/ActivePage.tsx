import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, RefreshCw, ExternalLink, X, Link as LinkIcon } from 'lucide-react';
import { useApplications, useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';
import { useGeneratePack, useUpdateAppStatus } from '../lib/mutations';
import { formatDate, formatTime, daysSince, hasRealJobUrl } from '../lib/format';
import { CompanyAvatar } from '../components/CompanyAvatar';
import { StatusBadge, StatusModal } from '../components/Status';
import { ImportJobModal } from '../components/ImportJobModal';

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

const ED_BTN = 'rounded-full border px-4 py-[0.5rem] text-[13px] font-medium uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;

// Drag-and-drop between columns is a bonus affordance on top of the
// existing buttons (Generate Pack / "I applied"), not a replacement —
// native HTML5 drag has no real touch support, so buttons stay the
// reliable path on mobile and for keyboard users.
const DRAG_MIME = 'application/x-nextrole-app';
type DragSource = 'added' | 'ready';

// Below md:, the four columns render one at a time behind a tab strip
// instead of stacking (see MOBILE_TABS / renderColumn in ActivePage) — same
// order as the desktop grid's columns.
type MobileTabKey = 'added' | 'ready' | 'applied' | 'interviewing';

function Card(
  { app, index, muted, dragFrom, children }:
  { app: Application; index: number; muted?: boolean; dragFrom?: DragSource; children: ReactNode },
) {
  const navigate = useNavigate();
  return (
    <article
      draggable={!!dragFrom}
      onDragStart={dragFrom ? (e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ id: app.id, from: dragFrom }));
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
      onClick={() => navigate(`/tracker/${app.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/tracker/${app.id}`); }}
      className={`ed-rise group flex flex-col gap-2 border border-[var(--ed-rule)] bg-[var(--ed-panel)] p-4 shadow-[0_6px_16px_-4px_rgba(0,0,0,0.45)] transition-all cursor-pointer hover:border-[var(--ed-ink-faint)] hover:shadow-[0_10px_22px_-4px_rgba(0,0,0,0.55)] hover:-translate-y-[1px] ${muted ? 'opacity-55 hover:opacity-90 transition-opacity' : ''}`}
      style={{ animationDelay: `${Math.min(index, 10) * 60}ms` }}
    >
      <div className="flex items-start gap-3">
        <CompanyAvatar name={app.company} logo={app.companyLogo} size={32} />
        <div className="min-w-0 flex-1">
          <span className="text-[13px] text-[var(--ed-ink-faint)] uppercase tracking-[0.04em] tabular-nums">
            {app.company}{app.matchScore != null && ` · ${app.matchScore}`}
          </span>
          <h3 className="text-[16px] font-medium leading-[1.3] text-[var(--ed-ink)] mt-[0.1rem] line-clamp-2">{app.jobTitle}</h3>
        </div>
      </div>
      {/* stopPropagation so clicking an action button doesn't also navigate */}
      <div className="mt-auto flex gap-2 items-center flex-wrap pt-1" onClick={(e) => e.stopPropagation()}>{children}</div>
    </article>
  );
}

function Column(
  { label, subtitle, count, isEmpty, emptyText, acceptsFrom, onDropApp, children }:
  {
    label: string; subtitle: string; count: number; isEmpty?: boolean; emptyText: string; children: ReactNode;
    acceptsFrom?: DragSource; onDropApp?: (appId: string) => void;
  },
) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`border p-5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)] transition-colors ${
        dragOver ? 'border-[var(--ed-accent)] bg-[var(--ed-accent)]/[0.06]' : 'border-[var(--ed-rule)] bg-[var(--ed-panel)]/30'
      }`}
      onDragOver={acceptsFrom ? (e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        setDragOver(true);
      } : undefined}
      onDragLeave={acceptsFrom ? () => setDragOver(false) : undefined}
      onDrop={acceptsFrom ? (e) => {
        e.preventDefault();
        setDragOver(false);
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (!raw) return;
        const { id, from } = JSON.parse(raw) as { id: string; from: DragSource };
        if (from === acceptsFrom) onDropApp?.(id);
      } : undefined}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--ed-rule)] pb-3 mb-5">
        <div>
          {/* Hidden below md: there the mobile tab strip already shows this
              column's label and count ("Ready 5") — repeating both here
              would just echo the tab immediately above it. */}
          <span className="hidden md:inline text-[13px] font-medium text-[var(--ed-ink-faint)]">{label}</span>
          <p className="text-[12px] text-[var(--ed-ink-faint)]/70 mt-[0.15rem]">{subtitle}</p>
        </div>
        <span className="hidden md:inline-flex shrink-0 items-center justify-center min-w-[1.3rem] h-[1.3rem] px-1 rounded-full bg-[var(--ed-panel)] border border-[var(--ed-rule)] text-[11px] text-[var(--ed-ink-faint)] tabular-nums">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {(isEmpty ?? count === 0) ? (
          <div className={`border border-dashed p-6 transition-colors ${dragOver ? 'border-[var(--ed-accent)]' : 'border-[var(--ed-rule)]'}`}>
            <p className="ed-display italic text-center text-[16px] text-[var(--ed-ink-faint)]">{emptyText}</p>
          </div>
        ) : children}
      </div>
    </div>
  );
}

// Moving to Interviewing happens automatically once mailbot parses an
// interview-scheduling email — no manual button here.
function AppliedCard(
  { app, index, muted }:
  { app: Application; index: number; muted?: boolean },
) {
  const days = daysSince(app.appliedAt ?? app.updatedAt ?? app.createdAt);
  return (
    <Card app={app} index={index} muted={muted}>
      {days !== null && (
        <span className="text-[13px] tabular-nums text-[var(--ed-ink-faint)]">
          Applied {days === 0 ? 'today' : `${days}d ago`}
        </span>
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
  const [showImportModal, setShowImportModal] = useState(false);
  const [statusTarget, setStatusTarget] = useState<{ id: string; status: string; jobUrl: string | null } | null>(null);
  // null until the initial default is applied (see the layout effect below)
  // or the user taps a tab — whichever comes first.
  const [mobileTab, setMobileTab] = useState<MobileTabKey | null>(null);

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

  // Picks the initial mobile tab exactly once, the moment real data first
  // lands (isLoading flips false) — not at mount, when every count is still
  // 0. The initialized ref makes this a one-shot: once mobileTab is set,
  // neither a later refetch's changed counts nor this effect re-running can
  // swap the tab out from under the user, whether they're looking at the
  // auto-pick or a tab they chose themselves. useLayoutEffect (not
  // useEffect) so the pick lands before paint — no visible flash of "Added".
  const mobileTabInitialized = useRef(false);
  useLayoutEffect(() => {
    if (isLoading || mobileTabInitialized.current) return;
    mobileTabInitialized.current = true;
    setMobileTab(
      added.length > 0 ? 'added'
      : ready.length > 0 ? 'ready'
      : appliedFresh.length > 0 ? 'applied'
      : inProcess.length > 0 ? 'interviewing'
      : 'added',
    );
  }, [isLoading, added.length, ready.length, appliedFresh.length, inProcess.length]);

  function markApplied(appId: string): void {
    updateStatus.mutate({ appId, newStatus: 'Applied' });
  }

  function IAppliedLink({ appId }: { appId: string }) {
    return (
      <button
        type="button"
        disabled={demoMode}
        title={demoMode ? DEMO_DISABLED_TITLE : undefined}
        className="text-[13px] font-medium uppercase tracking-[0.06em] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] transition-colors disabled:opacity-50 disabled:pointer-events-none"
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
        title="Remove from board (marks Withdrawn)"
        aria-label={`Remove application at ${company} from board`}
        className="ml-auto w-6 h-6 flex items-center justify-center text-[var(--ed-ink-faint)] hover:text-[var(--ed-no)] transition-[color,opacity] opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        onClick={() => updateStatus.mutate({ appId, newStatus: 'Withdrawn', jobUrl })}
      >
        <X size={13} aria-hidden="true" />
      </button>
    );
  }

  const MOBILE_TABS: { key: MobileTabKey; label: string; count: number }[] = [
    { key: 'added', label: 'Added', count: added.length },
    { key: 'ready', label: 'Ready', count: ready.length },
    { key: 'applied', label: 'Applied', count: appliedFresh.length },
    { key: 'interviewing', label: 'Interviewing', count: inProcess.length },
  ];
  const activeMobileTab = mobileTab ?? 'added';

  // Single source of truth for each column's props/content, called once per
  // column in the desktop grid and once more for whichever column the
  // mobile tab strip has selected — never forked, never duplicated.
  function renderColumn(key: MobileTabKey): ReactNode {
    switch (key) {
      case 'added':
        return (
          <Column key="added" label="Added" subtitle="Roles you're watching" count={added.length} emptyText="Add jobs from matches to track them here.">
            {added.map((a, i) => (
              <Card key={a.id} app={a} index={i} dragFrom={demoMode ? undefined : 'added'}>
                <button
                  type="button"
                  disabled={generatePack.isPending && generatePack.variables === a.id}
                  className={`${ED_PRIMARY} px-3 py-[0.4rem] inline-flex items-center gap-[0.35rem]`}
                  onClick={() => generatePack.mutate(a.id)}
                >
                  {generatePack.isPending && generatePack.variables === a.id
                    ? <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                    : <Sparkles size={12} aria-hidden="true" />}
                  Generate Pack
                </button>
                <RemoveButton appId={a.id} company={a.company} jobUrl={a.jobUrl} />
              </Card>
            ))}
          </Column>
        );
      case 'ready':
        return (
          <Column
            key="ready"
            label="Ready"
            subtitle="Résumé pack generated"
            count={ready.length}
            emptyText="Drag an added job here to build its pack."
            acceptsFrom="added"
            onDropApp={(id) => generatePack.mutate(id)}
          >
            {ready.map((a, i) => (
              <Card key={a.id} app={a} index={i} dragFrom={demoMode ? undefined : 'ready'}>
                <button type="button" className={`${ED_PRIMARY} px-3 py-[0.4rem]`} onClick={() => navigate(`/tracker/${a.id}/pack`)}>
                  Review
                </button>
                <button
                  type="button"
                  disabled={generatePack.isPending && generatePack.variables === a.id}
                  title="Regenerate the résumé pack"
                  aria-label={`Regenerate résumé pack for ${a.company}`}
                  className={`${ED_GHOST} px-3 py-[0.4rem] inline-flex items-center gap-[0.35rem]`}
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
        );
      case 'applied':
        return (
          <Column
            key="applied"
            label="Applied"
            subtitle="Roles you've applied to"
            count={appliedFresh.length}
            isEmpty={appliedFresh.length === 0 && appliedStale.length === 0}
            emptyText="Drag a ready job here once you've applied."
            acceptsFrom="ready"
            onDropApp={(id) => markApplied(id)}
          >
            {appliedFresh.map((a, i) => (
              <AppliedCard key={a.id} app={a} index={i} />
            ))}
            {appliedStale.length > 0 && (
              <details className="mt-1 group">
                <summary className="cursor-pointer list-none inline-flex items-baseline gap-[0.5rem] py-[0.4rem] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink-soft)] transition-colors">
                  <span aria-hidden="true" className="text-[13px] leading-none transition-transform group-open:rotate-90">▸</span>
                  <span className="text-[13px] tabular-nums">{appliedStale.length} more</span>
                </summary>
                <div className="flex flex-col gap-4 border-t border-[var(--ed-rule)] pt-4 mt-1">
                  {appliedStale.map((a, i) => (
                    <AppliedCard key={a.id} app={a} index={i} muted />
                  ))}
                </div>
              </details>
            )}
          </Column>
        );
      case 'interviewing':
        return (
          <Column key="interviewing" label="Interviewing" subtitle="Live interview processes" count={inProcess.length} emptyText="No live interview processes right now.">
            {inProcess.map((a, i) => (
              <Card key={a.id} app={a} index={i}>
                <StatusBadge status={a.status} />
                {a.nextInterviewAt && (
                  <span className="text-[13px] text-[var(--ed-ink-soft)] tabular-nums">
                    {formatDate(a.nextInterviewAt)} · {formatTime(a.nextInterviewAt)}
                    {a.nextInterviewEndsAt && `–${formatTime(a.nextInterviewEndsAt)}`}
                    {a.nextInterviewer && ` — ${a.nextInterviewer}`}
                  </span>
                )}
                {hasRealJobUrl(a.jobUrl) && (
                  <a
                    href={a.jobUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${ED_GHOST} px-3 py-[0.4rem] inline-flex items-center gap-[0.35rem]`}
                  >
                    <ExternalLink size={12} aria-hidden="true" />
                    View Job
                  </a>
                )}
                <button
                  type="button"
                  disabled={demoMode}
                  title={demoMode ? DEMO_DISABLED_TITLE : 'Close out — mark Rejected or Withdrawn'}
                  aria-label={`Close out application at ${a.company}`}
                  className="ml-auto w-6 h-6 flex items-center justify-center text-[var(--ed-ink-faint)] hover:text-[var(--ed-no)] transition-[color,opacity] disabled:opacity-40 disabled:pointer-events-none opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  onClick={() => setStatusTarget({ id: a.id, status: a.status, jobUrl: a.jobUrl })}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </Card>
            ))}
          </Column>
        );
    }
  }

  if (error) {
    return (
      <div className="editorial min-h-[calc(100vh-56px)] flex items-center justify-center p-8">
        <p className="text-[var(--ed-no)] text-[16px]">Failed to load: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="relative z-[1] max-w-[1800px] mx-auto px-8 pt-12 pb-16 max-[640px]:px-5 max-[640px]:pt-8">
        <header className="mb-9">
          <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[13px] font-medium uppercase tracking-[0.18em] text-[var(--ed-ink-faint)]">
            <span>Active</span>
          </div>
          <div className="flex items-end justify-between gap-4 pt-4 flex-wrap">
            <h1 className="font-medium text-[40px] leading-[1.1] tracking-[-0.01em] text-[var(--ed-ink)]">
              Active
            </h1>
            <button
              type="button"
              disabled={demoMode}
              title={demoMode ? DEMO_DISABLED_TITLE : undefined}
              className={`${ED_GHOST} px-3 py-[0.4rem] mb-1 inline-flex items-center gap-[0.35rem]`}
              onClick={() => setShowImportModal(true)}
            >
              <LinkIcon size={12} aria-hidden="true" />
              Import Job
            </button>
          </div>
          <div className="mt-5 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
        </header>

        {isLoading ? (
          <p className="text-center text-[var(--ed-ink-faint)] py-12 text-[16px]">Loading&hellip;</p>
        ) : (
          <>
            {/* Below md:, one column at a time behind a tab strip — stacking
                all four (including empty ones) meant scrolling past three
                full sections just to reach Interviewing. */}
            <div className="md:hidden">
              <div
                role="tablist"
                aria-label="Board status"
                className="grid grid-cols-4 rounded-xl border border-[var(--ed-rule)] divide-x divide-[var(--ed-rule)] overflow-hidden mb-5"
              >
                {MOBILE_TABS.map(({ key, label, count }) => {
                  const active = activeMobileTab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setMobileTab(key)}
                      className={`flex flex-col items-center justify-center gap-[0.15rem] py-[0.55rem] px-1 transition-colors ${
                        active ? 'text-[var(--ed-accent)] bg-[var(--ed-accent)]/10' : 'text-[var(--ed-ink-faint)]'
                      }`}
                    >
                      <span className="text-[0.68rem] font-medium leading-tight whitespace-nowrap">{label}</span>
                      <span className="text-[0.6rem] tabular-nums leading-none">{count}</span>
                    </button>
                  );
                })}
              </div>
              {renderColumn(activeMobileTab)}
            </div>

            {/* md: and up: unchanged four-up grid. */}
            <div className="hidden md:grid md:grid-cols-2 xl:grid-cols-4 gap-8 items-start">
              {renderColumn('added')}
              {renderColumn('ready')}
              {renderColumn('applied')}
              {renderColumn('interviewing')}
            </div>
          </>
        )}
      </div>

      {showImportModal && <ImportJobModal onClose={() => setShowImportModal(false)} />}

      {statusTarget && (
        <StatusModal
          appId={statusTarget.id}
          currentStatus={statusTarget.status}
          jobUrl={statusTarget.jobUrl}
          onClose={() => setStatusTarget(null)}
          onSaved={() => setStatusTarget(null)}
        />
      )}
    </div>
  );
}
