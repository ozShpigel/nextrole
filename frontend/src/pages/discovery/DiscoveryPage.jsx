import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { discoveryApi } from '../../utils/api';
import { relativeTime } from '../../utils/format';
import CriteriaForm from './CriteriaForm';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

const STATUS_LABEL = {
  pending: 'Pending',
  scraping: 'Scraping',
  scoring: 'Scoring',
  completed: 'Completed',
  failed: 'Failed',
};

function statusClass(status) {
  if (status === 'completed') return 'status-green';
  if (status === 'failed') return 'status-red';
  if (status === 'scraping' || status === 'scoring') return 'status-yellow';
  return 'status-dim';
}

const statusDotColors = {
  'status-green': 'bg-green',
  'status-red': 'bg-red',
  'status-yellow': 'bg-yellow animate-[timelinePulse_1.6s_ease-in-out_infinite]',
  'status-dim': 'bg-muted-foreground',
};

const statusBadgeColors = {
  'status-green': 'bg-green-bg text-green border-[rgba(45,143,94,0.18)]',
  'status-red': 'bg-red-bg text-red border-[rgba(196,84,84,0.18)]',
  'status-yellow': 'bg-yellow-bg text-yellow border-[rgba(166,139,43,0.18)]',
  'status-dim': 'bg-muted/50 text-muted-foreground border-border',
};

export default function DiscoveryPage() {
  const [criteria, setCriteria] = useState([]);
  const [runs, setRuns] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Render free tier cold-start feedback: lights up once the first retry fires.
  const [wakingUp, setWakingUp] = useState(false);
  const [wakeAttempt, setWakeAttempt] = useState(0);
  const [wakeStartedAt, setWakeStartedAt] = useState(null);
  const [wakeElapsed, setWakeElapsed] = useState(0);
  const navigate = useNavigate();
  const pollRef = useRef(null);

  useEffect(() => { load(); return () => clearInterval(pollRef.current); }, []);

  // Tick the elapsed counter while a wake-up is in progress.
  useEffect(() => {
    if (!wakingUp || !wakeStartedAt) return;
    const id = setInterval(() => {
      setWakeElapsed(Math.floor((Date.now() - wakeStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [wakingUp, wakeStartedAt]);

  async function load() {
    setLoading(true);
    setError(null);
    setWakingUp(false);
    setWakeAttempt(0);
    setWakeStartedAt(null);
    setWakeElapsed(0);
    const onRetry = ({ attempt }) => {
      setWakingUp(true);
      setWakeAttempt(attempt);
      setWakeStartedAt((prev) => prev ?? Date.now());
    };
    try {
      // Warm-up: prime the free-tier instance before the real data calls.
      // Render's edge (Cloudflare) returns 502 *instantly* for sleeping
      // services — it doesn't hold the connection — and rate-limits fast
      // retries with 429. So use a slow, wide cadence: fixed ~20s spacing
      // for ~100s total budget, which stays under the rate-limit threshold
      // and gives Render enough quiet time to finish its 30–60s cold start
      // between attempts.
      await discoveryApi('/health', {
        onRetry,
        retries: 5,
        retryMinDelayMs: 20000,
        retryMaxDelayMs: 25000,
      });
      setWakingUp(false);
      const c = await discoveryApi('/criteria', { onRetry });
      setCriteria(c);
      const r = await discoveryApi('/runs', { onRetry });
      setRuns(r);
      startPollingIfNeeded(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setWakingUp(false);
    }
  }

  function startPollingIfNeeded(runsList) {
    clearInterval(pollRef.current);
    const hasActive = runsList.some((r) => r.status === 'pending' || r.status === 'scraping' || r.status === 'scoring');
    if (!hasActive) return;
    pollRef.current = setInterval(async () => {
      try {
        const c = await discoveryApi('/criteria');
        setCriteria(c);
        const r = await discoveryApi('/runs');
        setRuns(r);
        if (!r.some((run) => run.status === 'pending' || run.status === 'scraping' || run.status === 'scoring')) {
          clearInterval(pollRef.current);
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  async function triggerRun(criteriaId) {
    try {
      await discoveryApi(`/run/${criteriaId}`, { method: 'POST' });
      load();
    } catch (e) {
      alert('Error starting search: ' + e.message);
    }
  }

  async function deleteCriteria(id) {
    if (!confirm('Delete this search criteria?')) return;
    try {
      await discoveryApi(`/criteria/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }

  async function abortRun(runId, e) {
    e.stopPropagation();
    if (!confirm('Abort this search?')) return;
    try {
      await discoveryApi(`/runs/${runId}/abort`, { method: 'POST' });
      load();
    } catch (err) {
      alert('Abort failed: ' + err.message);
    }
  }

  function onSaved() {
    setShowForm(false);
    setEditItem(null);
    load();
  }

  const lastRun = useMemo(() => runs[0]?.started_at, [runs]);

  if (loading) {
    return (
      <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-page-in isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
        {/* Atmospheric glows */}
        <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
        <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />

        {wakingUp ? (
          <div
            className="flex items-center gap-6 mt-16 mx-auto max-w-[560px] p-[1.8rem_2rem] border border-border rounded-lg shadow-md animate-wakeup-in max-[640px]:flex-col max-[640px]:text-center max-[640px]:p-[1.5rem_1.25rem]"
            style={{ background: 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, hsl(var(--card)) 55%, rgba(0,0,0,0.015) 100%)' }}
            role="status"
            aria-live="polite"
          >
            <div className="relative shrink-0 w-[52px] h-[52px]" aria-hidden="true">
              <span className="absolute inset-0 border border-dashed border-border rounded-full animate-[wakeupSpin_6s_linear_infinite]" />
              <span className="absolute top-1/2 left-1/2 w-[7px] h-[7px] rounded-full origin-[0_0] opacity-80 animate-[wakeupOrbit_1.4s_ease-in-out_infinite]" style={{ background: 'hsl(var(--primary))' }} />
              <span className="absolute top-1/2 left-1/2 w-[7px] h-[7px] rounded-full origin-[0_0] opacity-80 animate-[wakeupOrbit_1.4s_ease-in-out_0.35s_infinite]" style={{ background: '#3d9b85' }} />
              <span className="absolute top-1/2 left-1/2 w-[7px] h-[7px] rounded-full origin-[0_0] opacity-80 animate-[wakeupOrbit_1.4s_ease-in-out_0.7s_infinite]" style={{ background: '#8b6fc0' }} />
            </div>
            <div className="flex flex-col gap-[0.35rem] flex-1 min-w-0">
              <div className="font-serif text-[1.05rem] font-bold text-foreground tracking-[-0.005em]">Waking up the discovery service</div>
              <div className="text-[0.82rem] text-muted-foreground leading-[1.65]">
                The service was asleep (Render Free Tier). Waking up can take up to a minute — we are waiting and will retry automatically.
              </div>
              {wakeAttempt > 0 && (
                <div className="mt-1 font-mono text-[0.7rem] tracking-[0.14em] uppercase text-primary tabular-nums">
                  Attempt {wakeAttempt}
                  {wakeElapsed > 0 && <span className="text-muted-foreground tracking-[0.08em]"> · {wakeElapsed}s</span>}
                </div>
              )}
            </div>
          </div>
        ) : (
          <DiscoveryLoadingSkeleton />
        )}
      </div>
    );
  }

  return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-page-in isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      {/* Atmospheric glows */}
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />

      <header className="mb-8 relative">
        <div className="flex items-start justify-between gap-4 max-[640px]:flex-col">
          <div>
            <Badge variant="outline" className="font-mono text-[0.65rem] tracking-[0.26em] uppercase text-muted-foreground font-medium border-border bg-muted/50 mb-[1.2rem]">Discovery · LinkedIn + Indeed</Badge>
            <h1 className="font-serif text-[clamp(2rem,4vw,2.7rem)] font-bold text-foreground leading-[1.1] mb-[0.65rem] tracking-[-0.01em]">Job Discovery</h1>
            <p className="text-muted-foreground text-[0.95rem] max-w-[560px] leading-[1.6]">
              Automated job search from LinkedIn and Indeed with AI-powered scoring and matching via Claude.
            </p>
          </div>
          <Button onClick={() => { setEditItem(null); setShowForm(true); }}>
            + New Criteria
          </Button>
        </div>
        <Separator className="mt-[1.6rem]" />
      </header>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden mb-10 backdrop-blur-[8px] max-[640px]:grid-cols-1">
        <div className="bg-card p-[1rem_1.25rem] flex flex-col gap-1 transition-colors hover:bg-background">
          <span className="font-serif text-[1.55rem] font-bold text-foreground tabular-nums leading-[1.1] tracking-[-0.01em]">{criteria.length}</span>
          <span className="text-[0.7rem] text-muted-foreground tracking-[0.12em] uppercase font-medium">Active Criteria</span>
        </div>
        <div className="bg-card p-[1rem_1.25rem] flex flex-col gap-1 transition-colors hover:bg-background">
          <span className="font-serif text-[1.55rem] font-bold text-foreground tabular-nums leading-[1.1] tracking-[-0.01em]">{runs.length}</span>
          <span className="text-[0.7rem] text-muted-foreground tracking-[0.12em] uppercase font-medium">Search History</span>
        </div>
        <div className="bg-card p-[1rem_1.25rem] flex flex-col gap-1 transition-colors hover:bg-background">
          <span className={`font-serif font-bold tabular-nums leading-[1.1] tracking-[-0.01em] ${!lastRun ? 'text-muted-foreground text-[1.1rem] font-medium' : 'text-[1.55rem] text-foreground'}`}>
            {lastRun ? relativeTime(lastRun) : '—'}
          </span>
          <span className="text-[0.7rem] text-muted-foreground tracking-[0.12em] uppercase font-medium">Last Search</span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-4 p-[1rem_1.25rem] mb-8 bg-red-bg border border-[rgba(196,84,84,0.18)] rounded-lg animate-[resultIn_0.3s_ease_both] max-[640px]:flex-col max-[640px]:items-stretch">
          <div className="shrink-0 w-9 h-9 rounded-full bg-[rgba(196,84,84,0.12)] border border-[rgba(196,84,84,0.2)] text-red flex items-center justify-center font-serif font-bold text-[1.2rem]">!</div>
          <div className="flex-1 min-w-0">
            <div className="text-red text-[0.92rem] font-semibold mb-[0.2rem] font-serif">Loading Error</div>
            <div className="text-muted-foreground text-[0.82rem] font-mono break-words">{error}</div>
          </div>
          <div className="shrink-0">
            <Button variant="outline" size="sm" onClick={load}>Retry</Button>
          </div>
        </div>
      )}

      {showForm && (
        <CriteriaForm
          initial={editItem}
          onSave={onSaved}
          onCancel={() => { setShowForm(false); setEditItem(null); }}
        />
      )}

      {/* 01 — Criteria */}
      <section className="mb-[3.25rem] relative">
        <div className="flex items-baseline gap-[0.85rem] mb-[1.3rem] flex-wrap">
          <Badge variant="outline" className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] tabular-nums border-border bg-muted/50">01</Badge>
          <span className="font-serif text-[1.35rem] font-bold text-foreground tracking-[-0.005em]">Search Criteria</span>
        </div>

        {criteria.length === 0 ? (
          <Card className="border-[1.5px] border-dashed p-[2.75rem_1.5rem] text-center shadow-none">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted border border-border text-primary font-serif text-[1.5rem] font-bold mb-[0.85rem]">+</div>
            <div className="font-serif text-[1.05rem] font-semibold text-foreground mb-[0.3rem]">No search criteria</div>
            <div className="text-muted-foreground text-[0.85rem] leading-[1.6] mb-[1.1rem] max-w-[360px] mx-auto">
              Define your first criteria to start automatically scanning jobs from LinkedIn and Indeed.
            </div>
            <Button onClick={() => { setEditItem(null); setShowForm(true); }}>
              + Create New Criteria
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {criteria.map((c, i) => (
              <Card
                key={c.id}
                className="group relative p-[1.4rem_1.5rem] transition-all flex flex-col animate-card-in hover:border-border hover:shadow-[0_8px_24px_rgba(0,0,0,0.05)] hover:-translate-y-px"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                {/* Accent stripe */}
                <div className="absolute top-0 right-0 w-[3px] h-[40px] rounded-tr-lg opacity-60 transition-all group-hover:opacity-100 group-hover:h-[64px]" style={{ background: 'linear-gradient(180deg, var(--primary) 0%, transparent 100%)' }} />

                <div className="flex justify-between items-start gap-3 mb-[0.85rem]">
                  <h3 className="font-serif text-[1.15rem] font-bold text-foreground tracking-[-0.005em] leading-[1.3] flex-1 min-w-0">{c.name}</h3>
                  <div className="flex gap-[0.35rem] shrink-0">
                    <Button variant="outline" size="sm" onClick={() => { setEditItem(c); setShowForm(true); }}>Edit</Button>
                    <Button variant="destructive" size="sm" onClick={() => deleteCriteria(c.id)}>Delete</Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-[0.35rem] mb-[0.85rem]">
                  {c.job_titles.map((t, i) => <span key={i} className="py-[0.2rem] px-[0.6rem] bg-muted text-primary border border-border rounded-[6px] text-[0.78rem] font-medium tracking-[0.01em]">{t}</span>)}
                </div>

                <div className="flex flex-col gap-[0.35rem] py-[0.7rem] mb-[0.85rem] border-t border-dashed border-border border-b">
                  {c.locations.length > 0 && (
                    <div className="flex items-center justify-between gap-2 text-[0.8rem]">
                      <span className="text-muted-foreground tracking-[0.05em] text-[0.7rem] uppercase font-medium">Location</span>
                      <span className="text-foreground font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={c.locations.join(', ')}>
                        {c.locations.join(' · ')}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-[0.8rem]">
                    <span className="text-muted-foreground tracking-[0.05em] text-[0.7rem] uppercase font-medium">Sites</span>
                    <span className="text-foreground font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{c.site_names.join(' · ')}</span>
                  </div>
                </div>

                <div className="flex items-center gap-[0.6rem] mb-[0.85rem]">
                  <span className="text-[0.7rem] text-muted-foreground tracking-[0.1em] uppercase font-medium">Threshold</span>
                  <div className="flex-1 h-[5px] bg-muted rounded-full overflow-hidden relative">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${c.min_score_to_save}%`, background: 'linear-gradient(90deg, var(--primary), var(--ring))' }}
                    />
                  </div>
                  <span className="font-serif text-[0.9rem] font-bold text-foreground tabular-nums tracking-[-0.01em]">
                    {c.min_score_to_save}<small className="text-[0.65rem] text-muted-foreground font-medium font-mono tracking-[0.1em] uppercase ml-[0.2rem]">/100</small>
                  </span>
                </div>

                <Button className="w-full mt-auto" onClick={() => triggerRun(c.id)}>
                  Run Search →
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 02 — Runs timeline */}
      <section className="mb-[3.25rem] relative">
        <div className="flex items-baseline gap-[0.85rem] mb-[1.3rem] flex-wrap">
          <Badge variant="outline" className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] tabular-nums border-border bg-muted/50">02</Badge>
          <span className="font-serif text-[1.35rem] font-bold text-foreground tracking-[-0.005em]">Search History</span>
        </div>

        {runs.length === 0 ? (
          <Card className="border-[1.5px] border-dashed p-[2.75rem_1.5rem] text-center shadow-none">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted border border-border text-primary font-serif text-[1.5rem] font-bold mb-[0.85rem]">↻</div>
            <div className="font-serif text-[1.05rem] font-semibold text-foreground mb-[0.3rem]">No searches yet</div>
            <div className="text-muted-foreground text-[0.85rem] leading-[1.6] mb-[1.1rem] max-w-[360px] mx-auto">
              Run your first criteria to start collecting jobs.
            </div>
          </Card>
        ) : (
          <div className="relative pl-7">
            {/* Vertical timeline line */}
            <div
              className="absolute top-2 bottom-2 left-[7px] w-px pointer-events-none"
              style={{ background: 'linear-gradient(180deg, transparent, var(--border) 10%, var(--border) 90%, transparent)' }}
            />
            {runs.map((r, i) => {
              const sCls = statusClass(r.status);
              const isActive = r.status === 'scraping' || r.status === 'scoring' || r.status === 'pending';
              return (
                <div key={r.id} className="relative mb-[0.85rem] animate-card-in" style={{ animationDelay: `${i * 50}ms` }}>
                  <span className={`absolute top-[18px] -left-7 -ml-1 w-[11px] h-[11px] rounded-full border-2 border-background shadow-[0_0_0_1px_rgba(0,0,0,0.08)] z-[1] ${statusDotColors[sCls] || 'bg-muted-foreground'}`} />
                  <Card
                    className="p-[1rem_1.25rem] transition-all cursor-pointer hover:border-border hover:translate-x-[3px] hover:shadow-md hover:bg-background"
                    onClick={() => navigate(`/discovery/${r.id}`)}
                  >
                    <div className="flex justify-between items-center gap-2 mb-2">
                      <span className="font-serif font-bold text-foreground text-[1rem] tracking-[-0.005em] flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{r.criteria_name}</span>
                      <span className={`text-[0.7rem] font-medium py-[0.22rem] px-[0.65rem] rounded-full border tracking-[0.06em] font-mono shrink-0 ${statusBadgeColors[sCls] || ''}`}>{STATUS_LABEL[r.status] || r.status}</span>
                      {isActive && (
                        <button
                          type="button"
                          className="bg-transparent border border-border text-muted-foreground w-[1.55rem] h-[1.55rem] rounded-full text-[0.8rem] leading-none cursor-pointer inline-flex items-center justify-center transition-all shrink-0 hover:text-red hover:border-[rgba(196,84,84,0.4)] hover:bg-[rgba(196,84,84,0.06)]"
                          onClick={(e) => abortRun(r.id, e)}
                          title="Abort search"
                          aria-label="Abort search"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="flex gap-[1.1rem] text-[0.78rem] text-muted-foreground pt-[0.55rem] border-t border-dashed border-border flex-wrap max-[640px]:gap-2">
                      <span className="inline-flex items-baseline gap-[0.35rem]">
                        <span className="font-serif font-bold text-foreground tabular-nums">{r.jobs_scraped}</span>
                        <span>scraped</span>
                      </span>
                      <span className="inline-flex items-baseline gap-[0.35rem]">
                        <span className="font-serif font-bold text-foreground tabular-nums">{r.jobs_scored}</span>
                        <span>scored</span>
                      </span>
                      <span className="inline-flex items-baseline gap-[0.35rem]">
                        <span className="font-serif font-bold text-foreground tabular-nums">{r.jobs_saved}</span>
                        <span>saved</span>
                      </span>
                      <span className="inline-flex items-baseline gap-[0.35rem]">
                        <span className="font-serif font-bold text-foreground tabular-nums">{r.jobs_skipped_duplicate}</span>
                        <span>duplicates</span>
                      </span>
                    </div>
                    <div className="text-[0.72rem] text-muted-foreground mt-[0.4rem] tracking-[0.02em] tabular-nums">
                      {new Date(r.started_at).toLocaleString('en-US')}
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function DiscoveryLoadingSkeleton() {
  return (
    <div className="animate-page-in-fast relative" role="status" aria-live="polite" aria-label="Loading job discovery page">
      {/* Hero preview */}
      <header className="relative mb-10 pb-[1.6rem]">
        <div className="skeleton w-[180px] h-6 rounded-full mb-[1.3rem]" aria-hidden="true" />
        <h1 className="font-serif text-[clamp(2rem,4vw,2.7rem)] font-bold text-foreground leading-[1.1] mb-[0.85rem] tracking-[-0.01em] flex flex-wrap items-baseline gap-0" aria-hidden="true">
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(0 * 55ms + 80ms)' }}>J</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(1 * 55ms + 80ms)' }}>o</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(2 * 55ms + 80ms)' }}>b</span>
          <span className="inline-block w-[0.35em]">&nbsp;</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(3 * 55ms + 80ms)' }}>D</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(4 * 55ms + 80ms)' }}>i</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(5 * 55ms + 80ms)' }}>s</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(6 * 55ms + 80ms)' }}>c</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(7 * 55ms + 80ms)' }}>o</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(8 * 55ms + 80ms)' }}>v</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(9 * 55ms + 80ms)' }}>e</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(10 * 55ms + 80ms)' }}>r</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(11 * 55ms + 80ms)' }}>y</span>
        </h1>
        <div className="skeleton h-3 rounded-[4px] mt-[0.55rem] w-[70%]" aria-hidden="true" />
        <div className="skeleton h-3 rounded-[4px] mt-[0.55rem] w-[45%]" aria-hidden="true" />
        <div className="mt-[1.6rem] h-px relative overflow-hidden bg-border" aria-hidden="true">
          <span
            className="absolute top-[-1px] bottom-[-1px] w-[28%] blur-[0.5px] shadow-[0_0_6px_rgba(0,0,0,0.15)] animate-track-sweep"
            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.25) 50%, transparent 100%)' }}
          />
        </div>
      </header>

      {/* Stat-strip skeleton */}
      <div className="grid grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden mb-[2.75rem] max-[640px]:grid-cols-1" aria-hidden="true">
        <div className="bg-card p-[1rem_1.25rem] flex flex-col">
          <div className="skeleton w-[58px] h-7 rounded-[4px]" />
          <div className="skeleton w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
        <div className="bg-card p-[1rem_1.25rem] flex flex-col">
          <div className="skeleton w-[58px] h-7 rounded-[4px]" />
          <div className="skeleton w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
        <div className="bg-card p-[1rem_1.25rem] flex flex-col">
          <div className="skeleton w-[58px] h-7 rounded-[4px]" />
          <div className="skeleton w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
      </div>

      {/* Section heading + card grid skeleton */}
      <div className="mb-8">
        <div className="flex items-baseline gap-[0.85rem] mb-[1.1rem]" aria-hidden="true">
          <Badge variant="outline" className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] tabular-nums border-border bg-muted/50">01</Badge>
          <span className="skeleton inline-block w-[11ch] h-[22px] rounded-[4px] align-middle" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 max-[640px]:grid-cols-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="p-[1.4rem_1.35rem_1.25rem] bg-card border border-border rounded-lg shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden animate-[cardRise_0.65s_cubic-bezier(0.22,1,0.36,1)_both]"
              style={{ animationDelay: `${i * 70 + 320}ms` }}
              aria-hidden="true"
            >
              <div className="absolute top-0 left-0 w-[38px] h-[2px] opacity-35" style={{ background: 'linear-gradient(90deg, var(--primary), transparent)' }} />
              <div className="flex justify-between items-center gap-4">
                <div className="skeleton w-[55%] h-5 rounded-[4px]" />
                <div className="skeleton w-[72px] h-6 rounded-full" />
              </div>
              <div className="flex flex-wrap gap-[0.4rem] mt-[0.2rem]">
                <span className="skeleton inline-block w-[90px] h-[22px] rounded-full" />
                <span className="skeleton inline-block w-[58px] h-[22px] rounded-full" />
                <span className="skeleton inline-block w-[90px] h-[22px] rounded-full" />
              </div>
              <div className="skeleton w-full h-3 rounded-[4px]" />
            </div>
          ))}
        </div>
      </div>

      {/* Cycling subtitle */}
      <div className="mt-10 pt-[1.4rem] border-t border-dashed border-border flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-muted-foreground italic tracking-[-0.005em] relative max-[640px]:text-[0.85rem]">
        <span className="absolute -top-px left-0 w-9 h-px bg-primary opacity-50" />
        <span className="font-serif text-[1.15rem] text-primary opacity-75 not-italic" aria-hidden="true">§</span>
        <span className="relative inline-block h-[1.4em] min-w-[22ch] max-[640px]:min-w-[16ch]" aria-hidden="true">
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '0s' }}>Fetching search criteria</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '2s' }}>Loading recent runs</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '4s' }}>Syncing with discovery service</span>
        </span>
        <span className="sr-only">Loading page</span>
      </div>
    </div>
  );
}
