import { useState } from 'react';
import { useSemanticSearch, useSaveJob, useDismissJob } from '../lib/mutations';
import { useSearchFacets, useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';
import type { AdvisorJobBrief, SearchHit, SemanticSearchResponse } from '../lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ED_BTN = 'rounded-none border px-4 py-[0.55rem] text-[0.7rem] font-semibold uppercase tracking-[0.1em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;

// jobspy job_level values (LinkedIn-populated; other boards carry none, so
// filtering by seniority excludes them — noted in the UI copy).
const JOB_LEVELS = ['entry level', 'associate', 'mid-senior level', 'director', 'executive'];

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

export default function SearchPage() {
  const [limit, setLimit] = useState(10);
  const [daysBack, setDaysBack] = useState(3);
  const [location, setLocation] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [levels, setLevels] = useState<Set<string>>(() => new Set());
  // null = fused search across all facets (the default and recommended mode).
  const [facet, setFacet] = useState<string | null>(null);

  const facetsQuery = useSearchFacets();
  const facetNames = (facetsQuery.data?.facets ?? []).map((f) => f.name);

  const [result, setResult] = useState<SemanticSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

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
        limit,
        days_back: daysBack,
        location: location.trim() || null,
        is_remote: remoteOnly ? true : null,
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
    `rounded-none border px-3 py-[0.35rem] text-[0.68rem] font-semibold uppercase tracking-[0.06em] transition-all cursor-pointer ${
      active
        ? 'border-[var(--ed-accent)] bg-[var(--ed-accent)]/10 text-[var(--ed-accent)]'
        : 'border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]'
    }`;

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1040px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

        <header className="mb-9 relative">
          <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
            <span>Search</span>
            <span className="hidden sm:block text-[var(--ed-accent)]">Match · on demand</span>
          </div>
          <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">
            Search your <span className="italic font-medium text-[var(--ed-accent)]">Matches</span>
          </h1>
          <p className="mt-3 text-[var(--ed-ink-soft)] text-[0.95rem] max-w-[620px] leading-[1.6]">
            Your profile is matched against every collected job by meaning, not keywords.
            The top results get one AI career-advisor pass — ranked, with a verdict and rationale each.
          </p>
        </header>

        {/* Filters */}
        <section className="border-t-[3px] border-double border-[var(--ed-rule-strong)] pt-6 mb-10">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-x-6 gap-y-5 mb-5">
            <div className="flex flex-col gap-[0.45rem]">
              <Label htmlFor="search-limit" className={fieldLabel}>Max results</Label>
              <Input
                id="search-limit"
                type="number"
                min={1}
                max={15}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(15, Number(e.target.value) || 10)))}
                className="rounded-none border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)]"
              />
            </div>
            <div className="flex flex-col gap-[0.45rem]">
              <Label htmlFor="search-days" className={fieldLabel}>Collected within (days)</Label>
              <Input
                id="search-days"
                type="number"
                min={1}
                max={45}
                value={daysBack}
                onChange={(e) => setDaysBack(Math.max(1, Math.min(45, Number(e.target.value) || 3)))}
                className="rounded-none border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)]"
              />
            </div>
            <div className="flex flex-col gap-[0.45rem]">
              <Label htmlFor="search-location" className={fieldLabel}>Location contains</Label>
              <Input
                id="search-location"
                placeholder="e.g. Tel Aviv"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="rounded-none border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)]"
              />
            </div>
            <div className="flex flex-col gap-[0.45rem]">
              <span className={fieldLabel}>Work arrangement</span>
              <button type="button" className={chip(remoteOnly)} onClick={() => setRemoteOnly((v) => !v)} aria-pressed={remoteOnly}>
                Remote only
              </button>
            </div>
          </div>

          {facetNames.length > 1 && (
            <div className="flex flex-col gap-[0.45rem] mb-5">
              <span className={fieldLabel}>Search focus (your profile's role facets)</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={chip(facet === null)} onClick={() => setFacet(null)} aria-pressed={facet === null}>
                  All roles
                </button>
                {facetNames.map((name) => (
                  <button key={name} type="button" className={chip(facet === name)} onClick={() => setFacet(facet === name ? null : name)} aria-pressed={facet === name}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-[0.45rem] mb-6">
            <span className={fieldLabel}>Seniority (LinkedIn jobs only)</span>
            <div className="flex flex-wrap gap-2">
              {JOB_LEVELS.map((level) => (
                <button key={level} type="button" className={chip(levels.has(level))} onClick={() => toggleLevel(level)} aria-pressed={levels.has(level)}>
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" className={ED_PRIMARY} onClick={handleSearch} disabled={search.isPending}>
              {search.isPending ? 'Matching & advising…' : 'Search'}
            </button>
            {result && (
              <button type="button" className={ED_GHOST} onClick={() => { setResult(null); setError(null); }}>
                Clear
              </button>
            )}
            {search.isPending && (
              <span className="text-[0.8rem] text-[var(--ed-ink-faint)] italic">
                Vector search is instant — the advisor pass takes up to a minute.
              </span>
            )}
          </div>
          {error && <div className="mt-4 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[0.88rem] border border-[var(--ed-no)]/30">{error}</div>}
        </section>

        {/* Results */}
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

                {ranked.map(({ brief, hit }, idx) => {
                  const tone = VERDICT_TONE[brief.verdict] ?? 'var(--ed-ink-faint)';
                  const saved = hit != null && (savedIds.has(hit.id) || hit.saved_to_tracker);
                  const dismissed = hit != null && dismissedIds.has(hit.id);
                  return (
                    <article key={brief.jobId} className={`ed-rise border-t border-[var(--ed-rule-strong)] pt-7 pb-8 ${dismissed ? 'opacity-40' : ''}`} style={{ animationDelay: `${idx * 80}ms` }}>
                      <div className="grid grid-cols-[3rem_1fr_180px] gap-x-8 max-[820px]:grid-cols-1 max-[820px]:gap-x-0 max-[820px]:gap-y-5">
                        <div className="ed-display text-[1.5rem] leading-none pt-1 tabular-nums text-[var(--ed-ink-faint)] max-[820px]:hidden">{String(brief.rank).padStart(2, '0')}</div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-[var(--ed-ink-faint)] mb-2">
                            <span className="text-[var(--ed-accent)] font-bold normal-case tracking-[0.02em] text-[0.74rem]">{hit?.company ?? '—'}</span>
                            {hit?.location && <><span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-rule)]" /><span>{hit.location}</span></>}
                            {hit?.job_level && <><span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-rule)]" /><span>{hit.job_level}</span></>}
                            {hit?.is_remote && <><span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-rule)]" /><span>Remote</span></>}
                          </div>

                          <h3 className="ed-display font-semibold text-[clamp(1.45rem,2.6vw,2.05rem)] leading-[1.04] tracking-[-0.018em] text-[var(--ed-ink)] mb-3">{hit?.title ?? brief.jobId}</h3>

                          {brief.rationale && (
                            <div dir="rtl" className="text-[0.9rem] text-[var(--ed-ink-soft)] leading-[1.75] my-3 pr-4 border-r-2 border-[var(--ed-accent)] text-right">{brief.rationale}</div>
                          )}

                          {(brief.greenFlags.length > 0 || brief.redFlags.length > 0) && (
                            <div className="flex flex-wrap gap-[0.35rem] my-3" dir="rtl">
                              {brief.greenFlags.map((s, i) => (
                                <span key={`g${i}`} className="text-[0.74rem] py-[0.15rem] px-[0.5rem] bg-[var(--ed-yes)]/10 text-[var(--ed-yes)] border border-[var(--ed-yes)]/25">{s}</span>
                              ))}
                              {brief.redFlags.map((s, i) => (
                                <span key={`r${i}`} className="text-[0.74rem] py-[0.15rem] px-[0.5rem] bg-[var(--ed-no)]/10 text-[var(--ed-no)] border border-[var(--ed-no)]/25">{s}</span>
                              ))}
                            </div>
                          )}

                          <div className="flex gap-2 items-center mt-4 flex-wrap">
                            {hit?.job_url && <a href={hit.job_url} target="_blank" rel="noopener noreferrer" className={ED_GHOST}>View Job</a>}
                            {hit && !saved && !dismissed && (
                              <button type="button" disabled={demoMode} title={demoTitle} className={`${ED_PRIMARY} disabled:cursor-not-allowed`} onClick={() => handleSave(hit.id)}>Save to Tracker</button>
                            )}
                            {hit && !saved && !dismissed && (
                              <button type="button" disabled={demoMode} title={demoTitle} className={`${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10 disabled:cursor-not-allowed`} onClick={() => handleDismiss(hit.id)}>Dismiss</button>
                            )}
                            {saved && <span className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-yes)] py-[0.35rem] px-[0.7rem] border border-[var(--ed-yes)]/40">Saved</span>}
                            {dismissed && <span className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-[var(--ed-no)] py-[0.35rem] px-[0.7rem] border border-[var(--ed-no)]/40">Dismissed — won't reappear</span>}
                          </div>
                        </div>

                        <aside className="border-l border-[var(--ed-rule)] pl-6 max-[820px]:border-l-0 max-[820px]:border-t max-[820px]:border-[var(--ed-rule)] max-[820px]:pl-0 max-[820px]:pt-5">
                          <div className="text-[0.58rem] font-bold uppercase tracking-[0.2em] inline-flex items-center gap-[0.45rem] mb-3" style={{ color: tone }}>
                            <span className="w-[7px] h-[7px] rounded-full" style={{ background: tone }} />
                            {VERDICT_LABEL[brief.verdict] ?? brief.verdict}
                          </div>
                          {hit?.similarity != null && (
                            <div>
                              <div className="flex justify-between items-baseline mb-[0.3rem]">
                                <span className="text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-soft)]">Similarity</span>
                                <span className="ed-display text-[0.78rem] tabular-nums text-[var(--ed-ink)]">{Math.round(hit.similarity * 100)}%</span>
                              </div>
                              <span className="relative block h-[3px] bg-[var(--ed-rule)] overflow-hidden">
                                <span className="ed-fill bg-[var(--ed-ink)]" style={{ ['--p' as string]: hit.similarity }} />
                              </span>
                            </div>
                          )}
                          {hit?.facet_ranks && Object.keys(hit.facet_ranks).length > 0 && (
                            <div className="mt-3 flex flex-col gap-[0.25rem]">
                              <span className="text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-soft)]">Facet rank</span>
                              {Object.entries(hit.facet_ranks).map(([name, rank]) => (
                                <span key={name} className="text-[0.68rem] font-code text-[var(--ed-ink-faint)]">
                                  {name} <span className="text-[var(--ed-ink)] tabular-nums">#{rank}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </aside>
                      </div>
                    </article>
                  );
                })}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
