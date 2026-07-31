import { useState, useEffect } from 'react';
import { useSemanticSearch, useSaveJob, useDismissJob } from '../lib/mutations';
import { useSearchFacets, useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';
import type { AdvisorJobBrief, SearchHit, SemanticSearchResponse } from '../lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ED_BTN = 'rounded-full border px-4 py-[0.55rem] text-[0.7rem] font-semibold uppercase tracking-[0.1em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;

// jobspy job_level values (LinkedIn-populated; other boards carry none, so
// filtering by seniority excludes them — noted in the UI copy).
const JOB_LEVELS = ['entry level', 'associate', 'mid-senior level', 'director', 'executive'];

// Freshness window over discovered_at (when the job entered the pool, not its
// posting date). 45 = the pool's TTL, i.e. everything ("Any").
const DAYS_PRESETS = [
  { days: 45, label: 'Any' },
  { days: 1, label: '24h' },
  { days: 3, label: '3d' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
];

const VERDICT_TONE: Record<string, string> = {
  apply: 'var(--ed-yes)',
  maybe: 'var(--ed-gold)',
  skip: 'var(--ed-no)',
};

const VERDICT_LABEL: Record<string, string> = {
  apply: 'Apply',
  maybe: 'Maybe',
  skip: 'Skip',
};

interface RankedResult {
  brief: AdvisorJobBrief;
  hit: SearchHit | undefined;
}

// Deterministic hue from the company name — used for the colored-initial
// fallback when a job has no scraped logo (or the logo URL 404s/goes stale).
function hashHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function CompanyAvatar({ name, logo }: { name: string; logo?: string | null }) {
  const [logoFailed, setLogoFailed] = useState(false);
  if (logo && !logoFailed) {
    return (
      <img
        src={logo}
        alt=""
        className="w-11 h-11 rounded-full shrink-0 object-contain border border-[var(--ed-rule)] bg-white"
        onError={() => setLogoFailed(true)}
      />
    );
  }
  const hue = hashHue(name || '?');
  const initial = (name.trim()[0] || '?').toUpperCase();
  return (
    <div
      className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-bold text-[0.95rem] border"
      style={{ background: `hsl(${hue} 45% 16%)`, color: `hsl(${hue} 70% 72%)`, borderColor: `hsl(${hue} 45% 32%)` }}
    >
      {initial}
    </div>
  );
}

// Circular similarity meter — same data the old horizontal bar showed, just
// in the corner-badge shape a card grid calls for. Hovering it reveals the
// advisor's rationale + green/red flags as a floating panel, instead of a
// separate click-to-expand control taking up card space.
function MatchRing({ percent, tone, brief }: { percent: number; tone: string; brief: AdvisorJobBrief }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - percent / 100);
  const hasReasons = !!brief.rationale || brief.greenFlags.length > 0 || brief.redFlags.length > 0;

  return (
    <div className="group relative w-11 h-11 shrink-0">
      <svg viewBox="0 0 44 44" className="w-11 h-11 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--ed-rule)" strokeWidth="3.5" />
        <circle
          cx="22" cy="22" r={r} fill="none" stroke={tone} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 500ms ease-out' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-baseline justify-center gap-[1px] text-[0.68rem] font-bold tabular-nums" style={{ color: tone }}>
        {percent}<span className="text-[0.5rem] font-semibold">%</span>
      </span>

      {hasReasons && (
        <div
          role="tooltip"
          className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity duration-150 pointer-events-none absolute z-20 right-0 top-[calc(100%+0.6rem)] w-72 max-w-[80vw] p-4 rounded-lg border border-[var(--ed-rule)] bg-[var(--ed-panel)] shadow-[0_16px_36px_-10px_rgba(0,0,0,0.7)]"
        >
          <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-[var(--ed-ink-faint)] mb-2">Match rationale</span>
          <ul dir="rtl" className="flex flex-col gap-[0.4rem]">
            {brief.rationale && (
              <li className="flex items-start gap-2 text-[0.78rem] text-[var(--ed-ink)] leading-[1.5] text-right">
                <span className="mt-[0.5em] w-[5px] h-[5px] rounded-full shrink-0" style={{ background: tone }} />
                <span className="flex-1">{brief.rationale}</span>
              </li>
            )}
            {brief.greenFlags.map((s, i) => (
              <li key={`g${i}`} className="flex items-start gap-2 text-[0.78rem] text-[var(--ed-yes)] leading-[1.5] text-right">
                <span className="mt-[0.5em] w-[5px] h-[5px] rounded-full bg-[var(--ed-yes)] shrink-0" />
                <span className="flex-1">{s}</span>
              </li>
            ))}
            {brief.redFlags.map((s, i) => (
              <li key={`r${i}`} className="flex items-start gap-2 text-[0.78rem] text-[var(--ed-no)] leading-[1.5] text-right">
                <span className="mt-[0.5em] w-[5px] h-[5px] rounded-full bg-[var(--ed-no)] shrink-0" />
                <span className="flex-1">{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface MatchCardProps {
  brief: AdvisorJobBrief;
  hit: SearchHit | undefined;
  index: number;
  saved: boolean;
  dismissed: boolean;
  demoMode: boolean;
  demoTitle: string | undefined;
  onSave: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
}

function MatchCard({ brief, hit, index, saved, dismissed, demoMode, demoTitle, onSave, onDismiss }: MatchCardProps) {
  const tone = VERDICT_TONE[brief.verdict] ?? 'var(--ed-ink-faint)';
  const percent = hit?.similarity != null ? Math.round(hit.similarity * 100) : null;

  return (
    <article
      className={`ed-rise flex flex-col border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 p-5 transition-colors hover:border-[var(--ed-ink-faint)] ${dismissed ? 'opacity-40' : ''}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <CompanyAvatar name={hit?.company ?? '?'} logo={hit?.company_logo} />
        {percent != null && <MatchRing percent={percent} tone={tone} brief={brief} />}
      </div>

      <span className="text-[0.78rem] font-bold text-[var(--ed-accent)] mb-1 truncate">{hit?.company ?? '—'}</span>
      <div className="flex items-center gap-x-2 flex-wrap text-[0.7rem] text-[var(--ed-ink-faint)] mb-2">
        {hit?.location && <span>{hit.location}</span>}
        {hit?.is_remote && <><span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-rule)]" /><span>Remote</span></>}
        {hit?.job_level && <><span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-rule)]" /><span>{hit.job_level}</span></>}
      </div>

      <h3 className="ed-display font-semibold text-[1.05rem] leading-[1.3] tracking-[-0.01em] text-[var(--ed-ink)] mb-3 line-clamp-2 min-h-[2.6em]">
        {hit?.title ?? brief.jobId}
      </h3>

      <div
        className="text-[0.58rem] font-bold uppercase tracking-[0.18em] inline-flex items-center gap-[0.4rem] mb-4"
        style={{ color: tone }}
      >
        <span className="w-[6px] h-[6px] rounded-full" style={{ background: tone }} />
        {VERDICT_LABEL[brief.verdict] ?? brief.verdict}
      </div>

      <div className="mt-auto flex gap-2 items-center flex-wrap">
        {hit?.job_url && <a href={hit.job_url} target="_blank" rel="noopener noreferrer" className={`${ED_GHOST} text-[0.64rem] px-3 py-[0.45rem]`}>View Job</a>}
        {hit && !saved && !dismissed && (
          <button type="button" disabled={demoMode} title={demoTitle} className={`${ED_PRIMARY} text-[0.64rem] px-3 py-[0.45rem] disabled:cursor-not-allowed`} onClick={() => onSave(hit.id)}>Save</button>
        )}
        {hit && !saved && !dismissed && (
          <button type="button" disabled={demoMode} title={demoTitle} className={`${ED_BTN} text-[0.64rem] px-3 py-[0.45rem] border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10 disabled:cursor-not-allowed`} onClick={() => onDismiss(hit.id)}>Dismiss</button>
        )}
        {saved && <span className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-yes)] py-[0.35rem] px-[0.6rem] border border-[var(--ed-yes)]/40">Saved</span>}
        {dismissed && <span className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-no)] py-[0.35rem] px-[0.6rem] border border-[var(--ed-no)]/40">Dismissed</span>}
      </div>
    </article>
  );
}

// Fixed now that the "Max results" control is gone — was user-editable 1-15.
const RESULT_LIMIT = 10;

// A search costs a real advisor call (~$0.10-0.15, per docs/scoring-and-search.md)
// and results were previously plain useState — gone on every refresh. Persisted
// to localStorage (not just React Query's in-memory cache, which is equally
// wiped on a hard reload) so a refresh doesn't throw away the last search.
const STORAGE_KEY = 'nextrole:last-search';

interface PersistedSearch {
  result: SemanticSearchResponse;
  savedIds: string[];
  dismissedIds: string[];
  filters: {
    daysBack: number;
    location: string;
    workSetting: 'remote' | 'hybrid' | 'onsite' | null;
    levels: string[];
    facet: string | null;
  };
}

function loadPersistedSearch(): PersistedSearch | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedSearch) : null;
  } catch {
    return null;
  }
}

export default function SearchPage() {
  const [persisted] = useState(loadPersistedSearch);

  const [daysBack, setDaysBack] = useState(persisted?.filters.daysBack ?? 3);
  const [location, setLocation] = useState(persisted?.filters.location ?? '');
  // jobspy only carries a remote boolean — no hybrid signal exists in our data,
  // so "Hybrid" and "On-site" both filter to is_remote=false; "Remote" is the
  // only value with a real positive signal. null = no work-setting filter.
  const [workSetting, setWorkSetting] = useState<'remote' | 'hybrid' | 'onsite' | null>(persisted?.filters.workSetting ?? null);
  const [levels, setLevels] = useState<Set<string>>(() => new Set(persisted?.filters.levels ?? []));
  // null = fused search across all facets (the default and recommended mode).
  const [facet, setFacet] = useState<string | null>(persisted?.filters.facet ?? null);

  const facetsQuery = useSearchFacets();
  const facetNames = (facetsQuery.data?.facets ?? []).map((f) => f.name);

  const [result, setResult] = useState<SemanticSearchResponse | null>(persisted?.result ?? null);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set(persisted?.savedIds ?? []));
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set(persisted?.dismissedIds ?? []));

  // Keep the persisted snapshot in sync with everything that affects what's
  // rendered — clearing (`result === null`) drops the snapshot entirely.
  useEffect(() => {
    if (!result) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const snapshot: PersistedSearch = {
      result,
      savedIds: [...savedIds],
      dismissedIds: [...dismissedIds],
      filters: { daysBack, location, workSetting, levels: [...levels], facet },
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage full/unavailable (e.g. private browsing) — not critical.
    }
  }, [result, savedIds, dismissedIds, daysBack, location, workSetting, levels, facet]);

  const search = useSemanticSearch();
  const saveJob = useSaveJob();
  const dismissJob = useDismissJob();
  const demoMode = useDemoMode();
  const demoTitle = demoMode ? DEMO_DISABLED_TITLE : undefined;

  function toggleLevel(level: string): void {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function handleSearch(): void {
    if (search.isPending) return;
    setError(null);
    setResult(null);
    search.mutate(
      {
        limit: RESULT_LIMIT,
        days_back: daysBack,
        location: location.trim() || null,
        is_remote: workSetting === null ? null : workSetting === 'remote',
        job_levels: levels.size > 0 ? [...levels] : null,
        facet,
      },
      {
        onSuccess: (data) => setResult(data),
        onError: (e) => setError((e as Error).message),
      },
    );
  }

  async function handleSave(jobId: string): Promise<void> {
    try {
      await saveJob.mutateAsync(jobId);
      setSavedIds((prev) => new Set(prev).add(jobId));
    } catch (e) {
      alert('Save failed: ' + (e as Error).message);
    }
  }

  async function handleDismiss(jobId: string): Promise<void> {
    try {
      await dismissJob.mutateAsync(jobId);
      setDismissedIds((prev) => new Set(prev).add(jobId));
    } catch (e) {
      alert('Dismiss failed: ' + (e as Error).message);
    }
  }

  // Join the advisor's rankings with the raw hits (jobId ↔ id), rank order.
  const ranked: RankedResult[] = (result?.advisor?.rankings ?? [])
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((brief) => ({ brief, hit: result?.jobs.find((j) => j.id === brief.jobId) }));

  const fieldLabel = 'text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--ed-ink-faint)]';
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-[0.35rem] text-[0.68rem] font-semibold uppercase tracking-[0.06em] transition-all cursor-pointer ${
      active
        ? 'border-[var(--ed-accent)] bg-[var(--ed-accent)]/10 text-[var(--ed-accent)]'
        : 'border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
    }`;

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1280px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

        <header className="mb-9 relative">
          <div className="pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
            <span>Search</span>
          </div>
          <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">
            Search your <span className="italic font-medium text-[var(--ed-accent)]">Matches</span>
          </h1>
          <p className="mt-3 text-[var(--ed-ink-soft)] text-[0.95rem] max-w-[620px] leading-[1.6]">
            Your profile is matched against every collected job by meaning, not keywords.
            The top results get one AI career-advisor pass — ranked, with a verdict and rationale each.
          </p>
        </header>

        <div className="grid grid-cols-5 gap-8 items-start max-[900px]:grid-cols-1">

          {/* Filters — 1 of 5 columns, sticky below the global nav (h-14).
              min-w-0 matters here: without it, a grid item's default
              min-width:auto lets its widest unbreakable child (a long facet
              chip label) force the column past its 1/5 share, pushing the
              whole page into horizontal scroll. */}
          <aside className="ed-scroll col-span-1 min-w-0 sticky top-[4.5rem] border-t-[3px] border-double border-[var(--ed-rule-strong)] pt-6 max-h-[calc(100vh-5.5rem)] overflow-y-auto max-[900px]:static max-[900px]:max-h-none max-[900px]:overflow-visible">
            <div className="flex items-baseline justify-between gap-3 mb-5">
              <span className="ed-display italic font-semibold text-[1.15rem] tracking-[-0.01em] text-[var(--ed-ink)]">Filters</span>
              {result && (
                <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--ed-ink-faint)] tabular-nums">{ranked.length} match{ranked.length === 1 ? '' : 'es'}</span>
              )}
            </div>

            <div className="flex flex-col gap-[0.45rem] mb-5">
              <Label htmlFor="search-location" className={fieldLabel}>Location</Label>
              <Input
                id="search-location"
                placeholder="e.g. Tel Aviv"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="rounded-lg border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)]"
              />
            </div>

            <div className="flex flex-col gap-[0.45rem] mb-5">
              <span className={fieldLabel}>Work arrangement</span>
              <div className="flex flex-wrap gap-2">
                {(['remote', 'hybrid', 'onsite'] as const).map((setting) => (
                  <button
                    key={setting}
                    type="button"
                    className={chip(workSetting === setting)}
                    onClick={() => setWorkSetting((v) => (v === setting ? null : setting))}
                    aria-pressed={workSetting === setting}
                  >
                    {setting === 'onsite' ? 'On-site' : setting}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-[0.45rem] mb-5 pt-5 border-t border-[var(--ed-rule)]">
              <span className={fieldLabel}>Posted</span>
              <span className="text-[0.72rem] text-[var(--ed-ink-faint)] leading-[1.5] -mt-1">How far back jobs entered your pool, not their posting date.</span>
              <div className="flex flex-wrap gap-2">
                {DAYS_PRESETS.map(({ days, label }) => (
                  <button key={days} type="button" className={chip(daysBack === days)} onClick={() => setDaysBack(days)} aria-pressed={daysBack === days}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {facetNames.length > 1 && (
              <div className="flex flex-col gap-[0.45rem] mb-5 pt-5 border-t border-[var(--ed-rule)]">
                <span className={fieldLabel}>Search focus</span>
                <span className="text-[0.72rem] text-[var(--ed-ink-faint)] leading-[1.5] -mt-1">Your profile's role facets.</span>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={chip(facet === null)} onClick={() => setFacet(null)} aria-pressed={facet === null}>
                    All roles
                  </button>
                  {facetNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      title={name}
                      className={`${chip(facet === name)} max-w-full truncate block`}
                      onClick={() => setFacet(facet === name ? null : name)}
                      aria-pressed={facet === name}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-[0.45rem] mb-6 pt-5 border-t border-[var(--ed-rule)]">
              <span className={fieldLabel}>Seniority</span>
              <span className="text-[0.72rem] text-[var(--ed-ink-faint)] leading-[1.5] -mt-1">LinkedIn jobs only.</span>
              <div className="flex flex-wrap gap-2">
                {JOB_LEVELS.map((level) => (
                  <button key={level} type="button" className={chip(levels.has(level))} onClick={() => toggleLevel(level)} aria-pressed={levels.has(level)}>
                    {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-stretch gap-2 pt-5 border-t border-[var(--ed-rule-strong)]">
              <button type="button" className={ED_PRIMARY} onClick={handleSearch} disabled={search.isPending}>
                {search.isPending ? 'Matching & advising…' : 'Search'}
              </button>
              {result && (
                <button type="button" className={ED_GHOST} onClick={() => { setResult(null); setError(null); }}>
                  Clear
                </button>
              )}
              {search.isPending && (
                <span className="text-[0.78rem] text-[var(--ed-ink-faint)] italic">
                  Vector search is instant — the advisor pass takes up to a minute.
                </span>
              )}
            </div>
            {error && <div className="mt-4 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[0.88rem] border border-[var(--ed-no)]/30">{error}</div>}
          </aside>

        {/* Results — 4 of 5 columns. */}
        <div className="col-span-4 min-w-0 max-[900px]:col-span-1">
        {result && (
          <section>
            {ranked.length === 0 ? (
              <p className="text-center text-[var(--ed-ink-faint)] py-12 text-[0.95rem] border-t border-[var(--ed-rule-strong)]">
                No matches — widen the date range or relax the filters.
              </p>
            ) : (
              <>
                {result.advisor?.overallRecommendation && (
                  <div className="mb-10">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <span className="ed-display italic font-semibold text-[1.5rem] tracking-[-0.01em] text-[var(--ed-ink)]">The advisor's take</span>
                      <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">One pass · {ranked.length} roles</span>
                    </div>
                    <div dir="rtl" className="border-t border-[var(--ed-rule-strong)] pt-4 text-[0.95rem] text-[var(--ed-ink)] leading-[1.8] pr-4 border-r-2 border-r-[var(--ed-accent)] text-right">
                      {result.advisor.overallRecommendation}
                    </div>
                  </div>
                )}

                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="ed-display italic font-semibold text-[1.5rem] tracking-[-0.01em] text-[var(--ed-ink)]">Ranked matches</span>
                  <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">Best first</span>
                </div>

                <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
                  {ranked.map(({ brief, hit }, idx) => (
                    <MatchCard
                      key={brief.jobId}
                      brief={brief}
                      hit={hit}
                      index={idx}
                      saved={hit != null && (savedIds.has(hit.id) || hit.saved_to_tracker)}
                      dismissed={hit != null && dismissedIds.has(hit.id)}
                      demoMode={demoMode}
                      demoTitle={demoTitle}
                      onSave={handleSave}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        )}
        </div>

        </div>
      </div>
    </div>
  );
}
