import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { discoveryApi } from '../../utils/api';
import CriteriaForm from './CriteriaForm';
import '../../styles/discovery.css';

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
      <div className="discovery-page">
        {wakingUp ? (
          <div className="wakeup-panel" role="status" aria-live="polite">
            <div className="wakeup-panel__orbit" aria-hidden="true">
              <span className="wakeup-panel__dot" />
              <span className="wakeup-panel__dot" />
              <span className="wakeup-panel__dot" />
            </div>
            <div className="wakeup-panel__body">
              <div className="wakeup-panel__title">מעירים את שירות החיפוש</div>
              <div className="wakeup-panel__text">
                השירות היה במצב שינה (Render Free Tier). ההתעוררות יכולה לקחת עד כדקה — אנחנו ממתינים וננסה שוב אוטומטית.
              </div>
              {wakeAttempt > 0 && (
                <div className="wakeup-panel__attempt">
                  ניסיון {wakeAttempt}
                  {wakeElapsed > 0 && <span className="wakeup-panel__elapsed"> · {wakeElapsed}s</span>}
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
    <div className="discovery-page">
      <header className="discovery-hero">
        <div className="discovery-hero__top">
          <div>
            <span className="discovery-hero__eyebrow">Discovery · LinkedIn + Indeed</span>
            <h1 className="discovery-hero__title">גילוי משרות</h1>
            <p className="discovery-hero__sub">
              חיפוש אוטומטי של משרות מ-LinkedIn ו-Indeed עם דירוג והתאמה באמצעות Claude.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => { setEditItem(null); setShowForm(true); }}>
            + קריטריון חדש
          </button>
        </div>
        <hr className="discovery-hero__rule" />
      </header>

      {/* Stat strip */}
      <div className="discovery-strip">
        <div className="meta-item">
          <span className="meta-item__value">{criteria.length}</span>
          <span className="meta-item__label">קריטריונים פעילים</span>
        </div>
        <div className="meta-item">
          <span className="meta-item__value">{runs.length}</span>
          <span className="meta-item__label">חיפושים בהיסטוריה</span>
        </div>
        <div className="meta-item">
          <span className={`meta-item__value ${!lastRun ? 'meta-item__value--muted' : ''}`}>
            {lastRun ? relativeTime(lastRun) : '—'}
          </span>
          <span className="meta-item__label">חיפוש אחרון</span>
        </div>
      </div>

      {error && (
        <div className="error-panel">
          <div className="error-panel__icon">!</div>
          <div className="error-panel__body">
            <div className="error-panel__title">שגיאה בטעינה</div>
            <div className="error-panel__msg">{error}</div>
          </div>
          <div className="error-panel__actions">
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
      <section className="discovery-section">
        <div className="section-label">
          <span className="section-num">01</span>
          <span className="section-name">קריטריוני חיפוש</span>
        </div>

        {criteria.length === 0 ? (
          <div className="empty-state-card">
            <div className="empty-state-card__mark">+</div>
            <div className="empty-state-card__title">אין קריטריוני חיפוש</div>
            <div className="empty-state-card__desc">
              הגדר קריטריון ראשון כדי להתחיל לסרוק משרות אוטומטית מ-LinkedIn ו-Indeed.
            </div>
            <button className="btn btn-primary" onClick={() => { setEditItem(null); setShowForm(true); }}>
              + צור קריטריון חדש
            </button>
          </div>
        ) : (
          <div className="criteria-grid">
            {criteria.map((c, i) => (
              <div key={c.id} className="criteria-card" style={{ '--i': i }}>
                <div className="criteria-card__header">
                  <h3>{c.name}</h3>
                  <div className="criteria-card__actions">
                    <button className="btn btn-sm btn-secondary" onClick={() => { setEditItem(c); setShowForm(true); }}>ערוך</button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteCriteria(c.id)}>מחק</button>
                  </div>
                </div>

                <div className="criteria-tags">
                  {c.job_titles.map((t, i) => <span key={i} className="criteria-tag">{t}</span>)}
                </div>

                <div className="criteria-meta-grid">
                  {c.locations.length > 0 && (
                    <div className="criteria-meta-row">
                      <span className="criteria-meta-row__label">מיקום</span>
                      <span className="criteria-meta-row__value" title={c.locations.join(', ')}>
                        {c.locations.join(' · ')}
                      </span>
                    </div>
                  )}
                  <div className="criteria-meta-row">
                    <span className="criteria-meta-row__label">אתרים</span>
                    <span className="criteria-meta-row__value">{c.site_names.join(' · ')}</span>
                  </div>
                </div>

                <div className="score-gauge">
                  <span className="score-gauge__label">סף</span>
                  <div className="score-gauge__track">
                    <div
                      className="score-gauge__fill"
                      style={{ width: `${c.min_score_to_save}%` }}
                    />
                  </div>
                  <span className="score-gauge__value">
                    {c.min_score_to_save}<small>/100</small>
                  </span>
                </div>

                <button className="btn btn-primary btn-run" onClick={() => triggerRun(c.id)}>
                  הפעל חיפוש ←
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 02 — Runs timeline */}
      <section className="discovery-section">
        <div className="section-label">
          <span className="section-num">02</span>
          <span className="section-name">היסטוריית חיפושים</span>
        </div>

        {runs.length === 0 ? (
          <div className="empty-state-card">
            <div className="empty-state-card__mark">↻</div>
            <div className="empty-state-card__title">אין חיפושים עדיין</div>
            <div className="empty-state-card__desc">
              הרץ את הקריטריון הראשון שלך כדי להתחיל לאסוף משרות.
            </div>
          </div>
        ) : (
          <div className="runs-timeline">
            {runs.map((r, i) => {
              const sCls = statusClass(r.status);
              const isActive = r.status === 'scraping' || r.status === 'scoring' || r.status === 'pending';
              return (
                <div key={r.id} className="timeline-row" style={{ '--i': i }}>
                  <span className={`timeline-dot ${sCls}`} />
                  <div className="run-card" onClick={() => navigate(`/discovery/${r.id}`)}>
                    <div className="run-card__header">
                      <span className="run-card__name">{r.criteria_name}</span>
                      <span className={`run-status ${sCls}`}>{STATUS_LABEL[r.status] || r.status}</span>
                      {isActive && (
                        <button
                          type="button"
                          className="run-card__abort"
                          onClick={(e) => abortRun(r.id, e)}
                          title="בטל חיפוש"
                          aria-label="בטל חיפוש"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="run-card__stats">
                      <span className="run-card__stat">
                        <span className="run-card__stat-value">{r.jobs_scraped}</span>
                        <span>נסרקו</span>
                      </span>
                      <span className="run-card__stat">
                        <span className="run-card__stat-value">{r.jobs_scored}</span>
                        <span>דורגו</span>
                      </span>
                      <span className="run-card__stat">
                        <span className="run-card__stat-value">{r.jobs_saved}</span>
                        <span>נשמרו</span>
                      </span>
                      <span className="run-card__stat">
                        <span className="run-card__stat-value">{r.jobs_skipped_duplicate}</span>
                        <span>כפילויות</span>
                      </span>
                    </div>
                    <div className="run-card__date">
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
    <div className="discovery-loading" role="status" aria-live="polite" aria-label="טוען את דף גילוי המשרות">
      {/* Hero preview — matches the real hero so the transition to loaded
          content is continuous. Title fades in, skeleton stand-ins hold
          the spot where sub-copy and stats will appear. */}
      <header className="discovery-loading__hero">
        <div className="skeleton skeleton-pill" aria-hidden="true" />
        <h1 className="discovery-loading__title" aria-hidden="true">
          <span className="discovery-loading__title-letter" style={{ '--i': 0 }}>ג</span>
          <span className="discovery-loading__title-letter" style={{ '--i': 1 }}>י</span>
          <span className="discovery-loading__title-letter" style={{ '--i': 2 }}>ל</span>
          <span className="discovery-loading__title-letter" style={{ '--i': 3 }}>ו</span>
          <span className="discovery-loading__title-letter" style={{ '--i': 4 }}>י</span>
          <span className="discovery-loading__title-space">&nbsp;</span>
          <span className="discovery-loading__title-letter" style={{ '--i': 5 }}>מ</span>
          <span className="discovery-loading__title-letter" style={{ '--i': 6 }}>ש</span>
          <span className="discovery-loading__title-letter" style={{ '--i': 7 }}>ר</span>
          <span className="discovery-loading__title-letter" style={{ '--i': 8 }}>ו</span>
          <span className="discovery-loading__title-letter" style={{ '--i': 9 }}>ת</span>
        </h1>
        <div className="skeleton skeleton-line skeleton-line--long" aria-hidden="true" />
        <div className="skeleton skeleton-line skeleton-line--short" aria-hidden="true" />
        <div className="discovery-loading__track" aria-hidden="true">
          <span className="discovery-loading__track-wipe" />
        </div>
      </header>

      {/* Stat-strip skeleton */}
      <div className="discovery-loading__strip" aria-hidden="true">
        <div className="discovery-loading__strip-cell">
          <div className="skeleton skeleton-stat" />
          <div className="skeleton skeleton-label" />
        </div>
        <div className="discovery-loading__strip-cell">
          <div className="skeleton skeleton-stat" />
          <div className="skeleton skeleton-label" />
        </div>
        <div className="discovery-loading__strip-cell">
          <div className="skeleton skeleton-stat" />
          <div className="skeleton skeleton-label" />
        </div>
      </div>

      {/* Section heading + card grid skeleton */}
      <div className="discovery-loading__section">
        <div className="discovery-loading__section-head" aria-hidden="true">
          <span className="discovery-loading__section-num">01</span>
          <span className="skeleton skeleton-heading" />
        </div>
        <div className="discovery-loading__cards">
          {[0, 1, 2].map((i) => (
            <div key={i} className="discovery-loading__card" style={{ '--i': i }} aria-hidden="true">
              <div className="discovery-loading__card-row">
                <div className="skeleton skeleton-card-title" />
                <div className="skeleton skeleton-card-action" />
              </div>
              <div className="discovery-loading__card-tags">
                <span className="skeleton skeleton-tag" />
                <span className="skeleton skeleton-tag skeleton-tag--sm" />
                <span className="skeleton skeleton-tag" />
              </div>
              <div className="skeleton skeleton-line skeleton-line--full" />
            </div>
          ))}
        </div>
      </div>

      {/* Contextual subtitle — cycles through hints so the wait feels
          intentional rather than broken. Pure CSS cycling, 6s total. */}
      <div className="discovery-loading__subtitle">
        <span className="discovery-loading__glyph" aria-hidden="true">§</span>
        <span className="discovery-loading__cycle" aria-hidden="true">
          <span className="discovery-loading__cycle-item">מושכים את קריטריוני החיפוש</span>
          <span className="discovery-loading__cycle-item">טוענים ריצות אחרונות</span>
          <span className="discovery-loading__cycle-item">מסנכרנים עם שירות הגילוי</span>
        </span>
        <span className="sr-only">טוען את הדף</span>
      </div>
    </div>
  );
}
