import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { discoveryApi } from '../../utils/api';
import CriteriaForm from './CriteriaForm';

const STATUS_LABEL = {
  pending: 'ממתין',
  scraping: 'סורק',
  scoring: 'מדרג',
  completed: 'הושלם',
  failed: 'נכשל',
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
  'status-dim': 'bg-text-dim',
};

const statusBadgeColors = {
  'status-green': 'bg-green-bg text-green border-[rgba(45,143,94,0.18)]',
  'status-red': 'bg-red-bg text-red border-[rgba(196,84,84,0.18)]',
  'status-yellow': 'bg-yellow-bg text-yellow border-[rgba(166,139,43,0.18)]',
  'status-dim': 'bg-[rgba(120,100,70,0.04)] text-text-dim border-border',
};

function relativeTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `${mins} דק'`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ש'`;
  const days = Math.floor(hrs / 24);
  return `${days} י'`;
}

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

  useEffect(() => { load(); }, []);

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
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setWakingUp(false);
    }
  }

  async function triggerRun(criteriaId) {
    try {
      await discoveryApi(`/run/${criteriaId}`, { method: 'POST' });
      load();
    } catch (e) {
      alert('שגיאה בהפעלת חיפוש: ' + e.message);
    }
  }

  async function deleteCriteria(id) {
    if (!confirm('למחוק קריטריון חיפוש זה?')) return;
    try {
      await discoveryApi(`/criteria/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert('מחיקה נכשלה: ' + e.message);
    }
  }

  async function abortRun(runId, e) {
    e.stopPropagation();
    if (!confirm('לבטל את החיפוש הזה?')) return;
    try {
      await discoveryApi(`/runs/${runId}/abort`, { method: 'POST' });
      load();
    } catch (err) {
      alert('ביטול נכשל: ' + err.message);
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
        <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(168,130,86,0.06) 0%, transparent 65%)' }} />
        <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(61,155,133,0.045) 0%, transparent 65%)' }} />

        {wakingUp ? (
          <div
            className="flex items-center gap-6 mt-16 mx-auto max-w-[560px] p-[1.8rem_2rem] border border-[rgba(168,130,86,0.2)] rounded-lg shadow-md animate-wakeup-in max-[640px]:flex-col max-[640px]:text-center max-[640px]:p-[1.5rem_1.25rem]"
            style={{ background: 'linear-gradient(135deg, rgba(168,130,86,0.04) 0%, rgba(255,253,249,0.7) 55%, rgba(61,155,133,0.035) 100%)' }}
            role="status"
            aria-live="polite"
          >
            <div className="relative shrink-0 w-[52px] h-[52px]" aria-hidden="true">
              <span className="absolute inset-0 border border-dashed border-[rgba(168,130,86,0.35)] rounded-full animate-[wakeupSpin_6s_linear_infinite]" />
              <span className="absolute top-1/2 left-1/2 w-[7px] h-[7px] rounded-full origin-[0_0] opacity-80 animate-[wakeupOrbit_1.4s_ease-in-out_infinite]" style={{ background: '#a88256' }} />
              <span className="absolute top-1/2 left-1/2 w-[7px] h-[7px] rounded-full origin-[0_0] opacity-80 animate-[wakeupOrbit_1.4s_ease-in-out_0.35s_infinite]" style={{ background: '#3d9b85' }} />
              <span className="absolute top-1/2 left-1/2 w-[7px] h-[7px] rounded-full origin-[0_0] opacity-80 animate-[wakeupOrbit_1.4s_ease-in-out_0.7s_infinite]" style={{ background: '#8b6fc0' }} />
            </div>
            <div className="flex flex-col gap-[0.35rem] flex-1 min-w-0">
              <div className="font-serif text-[1.05rem] font-bold text-text-bright tracking-[-0.005em]">מעירים את שירות החיפוש</div>
              <div className="text-[0.82rem] text-text-secondary leading-[1.65]">
                השירות היה במצב שינה (Render Free Tier). ההתעוררות יכולה לקחת עד כדקה — אנחנו ממתינים וננסה שוב אוטומטית.
              </div>
              {wakeAttempt > 0 && (
                <div className="mt-1 font-mono text-[0.7rem] tracking-[0.14em] uppercase text-accent tabular-nums">
                  ניסיון {wakeAttempt}
                  {wakeElapsed > 0 && <span className="text-text-dim tracking-[0.08em]"> · {wakeElapsed}s</span>}
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
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(168,130,86,0.06) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(61,155,133,0.045) 0%, transparent 65%)' }} />

      <header className="mb-8 relative">
        <div className="flex items-start justify-between gap-4 max-[640px]:flex-col">
          <div>
            <span className="inline-block font-mono text-[0.65rem] tracking-[0.26em] uppercase text-accent font-medium py-[0.3rem] px-[0.85rem] border border-[rgba(168,130,86,0.2)] rounded-full bg-[rgba(168,130,86,0.035)] mb-[1.2rem]">Discovery · LinkedIn + Indeed</span>
            <h1 className="font-serif text-[clamp(2rem,4vw,2.7rem)] font-bold text-text-bright leading-[1.1] mb-[0.65rem] tracking-[-0.01em]">גילוי משרות</h1>
            <p className="text-text-secondary text-[0.95rem] max-w-[560px] leading-[1.6]">
              חיפוש אוטומטי של משרות מ-LinkedIn ו-Indeed עם דירוג והתאמה באמצעות Claude.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => { setEditItem(null); setShowForm(true); }}>
            + קריטריון חדש
          </button>
        </div>
        <hr className="mt-[1.6rem] border-none h-px" style={{ background: 'linear-gradient(to left, transparent, rgba(168,130,86,0.28) 50%, transparent)' }} />
      </header>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden mb-10 backdrop-blur-[8px] max-[640px]:grid-cols-1">
        <div className="bg-[rgba(255,253,249,0.7)] p-[1rem_1.25rem] flex flex-col gap-1 transition-colors hover:bg-white">
          <span className="font-serif text-[1.55rem] font-bold text-text-bright tabular-nums leading-[1.1] tracking-[-0.01em]">{criteria.length}</span>
          <span className="text-[0.7rem] text-text-dim tracking-[0.12em] uppercase font-medium">קריטריונים פעילים</span>
        </div>
        <div className="bg-[rgba(255,253,249,0.7)] p-[1rem_1.25rem] flex flex-col gap-1 transition-colors hover:bg-white">
          <span className="font-serif text-[1.55rem] font-bold text-text-bright tabular-nums leading-[1.1] tracking-[-0.01em]">{runs.length}</span>
          <span className="text-[0.7rem] text-text-dim tracking-[0.12em] uppercase font-medium">חיפושים בהיסטוריה</span>
        </div>
        <div className="bg-[rgba(255,253,249,0.7)] p-[1rem_1.25rem] flex flex-col gap-1 transition-colors hover:bg-white">
          <span className={`font-serif font-bold tabular-nums leading-[1.1] tracking-[-0.01em] ${!lastRun ? 'text-text-dim text-[1.1rem] font-medium' : 'text-[1.55rem] text-text-bright'}`}>
            {lastRun ? relativeTime(lastRun) : '—'}
          </span>
          <span className="text-[0.7rem] text-text-dim tracking-[0.12em] uppercase font-medium">חיפוש אחרון</span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-4 p-[1rem_1.25rem] mb-8 bg-red-bg border border-[rgba(196,84,84,0.18)] rounded-lg animate-[resultIn_0.3s_ease_both] max-[640px]:flex-col max-[640px]:items-stretch">
          <div className="shrink-0 w-9 h-9 rounded-full bg-[rgba(196,84,84,0.12)] border border-[rgba(196,84,84,0.2)] text-red flex items-center justify-center font-serif font-bold text-[1.2rem]">!</div>
          <div className="flex-1 min-w-0">
            <div className="text-red text-[0.92rem] font-semibold mb-[0.2rem] font-serif">שגיאה בטעינה</div>
            <div className="text-text-secondary text-[0.82rem] font-mono break-words text-right" style={{ direction: 'ltr' }}>{error}</div>
          </div>
          <div className="shrink-0">
            <button className="btn btn-secondary btn-sm" onClick={load}>נסה שוב</button>
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
          <span className="font-serif text-[0.78rem] font-bold text-accent tracking-[0.14em] py-[0.15rem] px-[0.45rem] border border-[rgba(168,130,86,0.2)] rounded-[4px] bg-[rgba(168,130,86,0.04)] tabular-nums">01</span>
          <span className="font-serif text-[1.35rem] font-bold text-text-bright tracking-[-0.005em]">קריטריוני חיפוש</span>
        </div>

        {criteria.length === 0 ? (
          <div className="border-[1.5px] border-dashed border-[rgba(168,130,86,0.22)] rounded-lg p-[2.75rem_1.5rem] text-center bg-[rgba(255,253,249,0.5)]">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[rgba(168,130,86,0.08)] border border-[rgba(168,130,86,0.18)] text-accent font-serif text-[1.5rem] font-bold mb-[0.85rem]">+</div>
            <div className="font-serif text-[1.05rem] font-semibold text-text-bright mb-[0.3rem]">אין קריטריוני חיפוש</div>
            <div className="text-text-secondary text-[0.85rem] leading-[1.6] mb-[1.1rem] max-w-[360px] mx-auto">
              הגדר קריטריון ראשון כדי להתחיל לסרוק משרות אוטומטית מ-LinkedIn ו-Indeed.
            </div>
            <button className="btn btn-primary" onClick={() => { setEditItem(null); setShowForm(true); }}>
              + צור קריטריון חדש
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {criteria.map((c, i) => (
              <div
                key={c.id}
                className="group relative bg-warm border border-border rounded-lg p-[1.4rem_1.5rem] transition-all flex flex-col animate-card-in hover:border-[rgba(168,130,86,0.22)] hover:shadow-[0_8px_24px_rgba(80,60,30,0.05)] hover:-translate-y-px"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                {/* Accent stripe */}
                <div className="absolute top-0 right-0 w-[3px] h-[40px] rounded-tr-lg opacity-60 transition-all group-hover:opacity-100 group-hover:h-[64px]" style={{ background: 'linear-gradient(180deg, var(--accent) 0%, transparent 100%)' }} />

                <div className="flex justify-between items-start gap-3 mb-[0.85rem]">
                  <h3 className="font-serif text-[1.15rem] font-bold text-text-bright tracking-[-0.005em] leading-[1.3] flex-1 min-w-0">{c.name}</h3>
                  <div className="flex gap-[0.35rem] shrink-0">
                    <button className="btn btn-sm btn-secondary" onClick={() => { setEditItem(c); setShowForm(true); }}>ערוך</button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteCriteria(c.id)}>מחק</button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-[0.35rem] mb-[0.85rem]">
                  {c.job_titles.map((t, i) => <span key={i} className="py-[0.2rem] px-[0.6rem] bg-accent-muted text-accent border border-[rgba(168,130,86,0.12)] rounded-[6px] text-[0.78rem] font-medium tracking-[0.01em]">{t}</span>)}
                </div>

                <div className="flex flex-col gap-[0.35rem] py-[0.7rem] mb-[0.85rem] border-t border-dashed border-[rgba(120,100,70,0.12)] border-b">
                  {c.locations.length > 0 && (
                    <div className="flex items-center justify-between gap-2 text-[0.8rem]">
                      <span className="text-text-dim tracking-[0.05em] text-[0.7rem] uppercase font-medium">מיקום</span>
                      <span className="text-text-primary font-medium text-left min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" style={{ direction: 'ltr' }} title={c.locations.join(', ')}>
                        {c.locations.join(' · ')}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-[0.8rem]">
                    <span className="text-text-dim tracking-[0.05em] text-[0.7rem] uppercase font-medium">אתרים</span>
                    <span className="text-text-primary font-medium text-left min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" style={{ direction: 'ltr' }}>{c.site_names.join(' · ')}</span>
                  </div>
                </div>

                <div className="flex items-center gap-[0.6rem] mb-[0.85rem]">
                  <span className="text-[0.7rem] text-text-dim tracking-[0.1em] uppercase font-medium">סף</span>
                  <div className="flex-1 h-[5px] bg-[rgba(120,100,70,0.08)] rounded-full overflow-hidden relative">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${c.min_score_to_save}%`, background: 'linear-gradient(90deg, #a88256, #bf9868)' }}
                    />
                  </div>
                  <span className="font-serif text-[0.9rem] font-bold text-text-bright tabular-nums tracking-[-0.01em]">
                    {c.min_score_to_save}<small className="text-[0.65rem] text-text-dim font-medium font-mono tracking-[0.1em] uppercase ms-[0.2rem]">/100</small>
                  </span>
                </div>

                <button className="btn btn-primary w-full mt-auto" onClick={() => triggerRun(c.id)}>
                  הפעל חיפוש ←
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 02 — Runs timeline */}
      <section className="mb-[3.25rem] relative">
        <div className="flex items-baseline gap-[0.85rem] mb-[1.3rem] flex-wrap">
          <span className="font-serif text-[0.78rem] font-bold text-accent tracking-[0.14em] py-[0.15rem] px-[0.45rem] border border-[rgba(168,130,86,0.2)] rounded-[4px] bg-[rgba(168,130,86,0.04)] tabular-nums">02</span>
          <span className="font-serif text-[1.35rem] font-bold text-text-bright tracking-[-0.005em]">היסטוריית חיפושים</span>
        </div>

        {runs.length === 0 ? (
          <div className="border-[1.5px] border-dashed border-[rgba(168,130,86,0.22)] rounded-lg p-[2.75rem_1.5rem] text-center bg-[rgba(255,253,249,0.5)]">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[rgba(168,130,86,0.08)] border border-[rgba(168,130,86,0.18)] text-accent font-serif text-[1.5rem] font-bold mb-[0.85rem]">↻</div>
            <div className="font-serif text-[1.05rem] font-semibold text-text-bright mb-[0.3rem]">אין חיפושים עדיין</div>
            <div className="text-text-secondary text-[0.85rem] leading-[1.6] mb-[1.1rem] max-w-[360px] mx-auto">
              הרץ את הקריטריון הראשון שלך כדי להתחיל לאסוף משרות.
            </div>
          </div>
        ) : (
          <div className="relative pe-7">
            {/* Vertical timeline line */}
            <div
              className="absolute top-2 bottom-2 right-[7px] w-px pointer-events-none"
              style={{ background: 'linear-gradient(180deg, transparent, rgba(168,130,86,0.22) 10%, rgba(168,130,86,0.22) 90%, transparent)' }}
            />
            {runs.map((r, i) => {
              const sCls = statusClass(r.status);
              const isActive = r.status === 'scraping' || r.status === 'scoring' || r.status === 'pending';
              return (
                <div key={r.id} className="relative mb-[0.85rem] animate-card-in" style={{ animationDelay: `${i * 50}ms` }}>
                  <span className={`absolute top-[18px] -right-7 -me-1 w-[11px] h-[11px] rounded-full border-2 border-bg-deep shadow-[0_0_0_1px_rgba(120,100,70,0.12)] z-[1] ${statusDotColors[sCls] || 'bg-text-dim'}`} />
                  <div
                    className="bg-warm border border-border rounded-lg p-[1rem_1.25rem] transition-all cursor-pointer hover:border-[rgba(168,130,86,0.22)] hover:-translate-x-[3px] hover:shadow-md hover:bg-white"
                    onClick={() => navigate(`/discovery/${r.id}`)}
                  >
                    <div className="flex justify-between items-center gap-2 mb-2">
                      <span className="font-serif font-bold text-text-bright text-[1rem] tracking-[-0.005em] flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{r.criteria_name}</span>
                      <span className={`text-[0.7rem] font-medium py-[0.22rem] px-[0.65rem] rounded-full border tracking-[0.06em] font-mono shrink-0 ${statusBadgeColors[sCls] || ''}`}>{STATUS_LABEL[r.status] || r.status}</span>
                      {isActive && (
                        <button
                          type="button"
                          className="bg-transparent border border-border text-text-dim w-[1.55rem] h-[1.55rem] rounded-full text-[0.8rem] leading-none cursor-pointer inline-flex items-center justify-center transition-all shrink-0 hover:text-red hover:border-[rgba(196,84,84,0.4)] hover:bg-[rgba(196,84,84,0.06)]"
                          onClick={(e) => abortRun(r.id, e)}
                          title="בטל חיפוש"
                          aria-label="בטל חיפוש"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="flex gap-[1.1rem] text-[0.78rem] text-text-secondary pt-[0.55rem] border-t border-dashed border-[rgba(120,100,70,0.12)] flex-wrap max-[640px]:gap-2">
                      <span className="inline-flex items-baseline gap-[0.35rem]">
                        <span className="font-serif font-bold text-text-bright tabular-nums">{r.jobs_scraped}</span>
                        <span>נסרקו</span>
                      </span>
                      <span className="inline-flex items-baseline gap-[0.35rem]">
                        <span className="font-serif font-bold text-text-bright tabular-nums">{r.jobs_scored}</span>
                        <span>דורגו</span>
                      </span>
                      <span className="inline-flex items-baseline gap-[0.35rem]">
                        <span className="font-serif font-bold text-text-bright tabular-nums">{r.jobs_saved}</span>
                        <span>נשמרו</span>
                      </span>
                      <span className="inline-flex items-baseline gap-[0.35rem]">
                        <span className="font-serif font-bold text-text-bright tabular-nums">{r.jobs_skipped_duplicate}</span>
                        <span>כפילויות</span>
                      </span>
                    </div>
                    <div className="text-[0.72rem] text-text-dim mt-[0.4rem] tracking-[0.02em] text-right tabular-nums" style={{ direction: 'ltr' }}>
                      {new Date(r.started_at).toLocaleString('he-IL')}
                    </div>
                  </div>
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
    <div className="animate-page-in-fast relative" role="status" aria-live="polite" aria-label="טוען את דף גילוי המשרות">
      {/* Hero preview */}
      <header className="relative mb-10 pb-[1.6rem]">
        <div className="skeleton w-[180px] h-6 rounded-full mb-[1.3rem]" aria-hidden="true" />
        <h1 className="font-serif text-[clamp(2rem,4vw,2.7rem)] font-bold text-text-bright leading-[1.1] mb-[0.85rem] tracking-[-0.01em] flex flex-wrap items-baseline gap-0" aria-hidden="true">
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(0 * 55ms + 80ms)' }}>ג</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(1 * 55ms + 80ms)' }}>י</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(2 * 55ms + 80ms)' }}>ל</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(3 * 55ms + 80ms)' }}>ו</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(4 * 55ms + 80ms)' }}>י</span>
          <span className="inline-block w-[0.35em]">&nbsp;</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(5 * 55ms + 80ms)' }}>מ</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(6 * 55ms + 80ms)' }}>ש</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(7 * 55ms + 80ms)' }}>ר</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(8 * 55ms + 80ms)' }}>ו</span>
          <span className="inline-block opacity-0 translate-y-[6px] animate-[letterInk_0.55s_cubic-bezier(0.22,1,0.36,1)_forwards]" style={{ animationDelay: 'calc(9 * 55ms + 80ms)' }}>ת</span>
        </h1>
        <div className="skeleton h-3 rounded-[4px] mt-[0.55rem] w-[70%]" aria-hidden="true" />
        <div className="skeleton h-3 rounded-[4px] mt-[0.55rem] w-[45%]" aria-hidden="true" />
        <div className="mt-[1.6rem] h-px relative overflow-hidden" style={{ background: 'linear-gradient(to left, transparent, rgba(168,130,86,0.18) 50%, transparent)' }} aria-hidden="true">
          <span
            className="absolute top-[-1px] bottom-[-1px] w-[28%] blur-[0.5px] shadow-[0_0_6px_rgba(168,130,86,0.3)] animate-track-sweep"
            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(168,130,86,0.55) 50%, transparent 100%)' }}
          />
        </div>
      </header>

      {/* Stat-strip skeleton */}
      <div className="grid grid-cols-3 gap-px bg-border border border-border rounded-lg overflow-hidden mb-[2.75rem] max-[640px]:grid-cols-1" aria-hidden="true">
        <div className="bg-[rgba(255,253,249,0.7)] p-[1rem_1.25rem] flex flex-col">
          <div className="skeleton w-[58px] h-7 rounded-[4px]" />
          <div className="skeleton w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
        <div className="bg-[rgba(255,253,249,0.7)] p-[1rem_1.25rem] flex flex-col">
          <div className="skeleton w-[58px] h-7 rounded-[4px]" />
          <div className="skeleton w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
        <div className="bg-[rgba(255,253,249,0.7)] p-[1rem_1.25rem] flex flex-col">
          <div className="skeleton w-[58px] h-7 rounded-[4px]" />
          <div className="skeleton w-[88px] h-[10px] rounded-[3px] mt-2" />
        </div>
      </div>

      {/* Section heading + card grid skeleton */}
      <div className="mb-8">
        <div className="flex items-baseline gap-[0.85rem] mb-[1.1rem]" aria-hidden="true">
          <span className="font-serif text-[0.78rem] font-bold text-accent tracking-[0.14em] py-[0.15rem] px-[0.45rem] border border-[rgba(168,130,86,0.2)] rounded-[4px] bg-[rgba(168,130,86,0.04)] tabular-nums">01</span>
          <span className="skeleton inline-block w-[11ch] h-[22px] rounded-[4px] align-middle" />
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 max-[640px]:grid-cols-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="p-[1.4rem_1.35rem_1.25rem] bg-bg-card border border-border rounded-lg shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden animate-[cardRise_0.65s_cubic-bezier(0.22,1,0.36,1)_both]"
              style={{ animationDelay: `${i * 70 + 320}ms` }}
              aria-hidden="true"
            >
              <div className="absolute top-0 start-0 w-[38px] h-[2px] opacity-35" style={{ background: 'linear-gradient(90deg, var(--accent), transparent)' }} />
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
      <div className="mt-10 pt-[1.4rem] border-t border-dashed border-[rgba(120,100,70,0.14)] flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-text-secondary italic tracking-[-0.005em] relative max-[640px]:text-[0.85rem]">
        <span className="absolute -top-px start-0 w-9 h-px bg-accent opacity-50" />
        <span className="font-serif text-[1.15rem] text-accent opacity-75 not-italic" aria-hidden="true">§</span>
        <span className="relative inline-block h-[1.4em] min-w-[22ch] max-[640px]:min-w-[16ch]" aria-hidden="true">
          <span className="absolute inset-0 start-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '0s' }}>מושכים את קריטריוני החיפוש</span>
          <span className="absolute inset-0 start-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '2s' }}>טוענים ריצות אחרונות</span>
          <span className="absolute inset-0 start-0 opacity-0 translate-y-[6px] animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '4s' }}>מסנכרנים עם שירות הגילוי</span>
        </span>
        <span className="sr-only">טוען את הדף</span>
      </div>
    </div>
  );
}
