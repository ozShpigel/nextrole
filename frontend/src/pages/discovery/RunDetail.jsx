import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { discoveryApi } from '../../utils/api';
import { VERDICT_HE } from '../../utils/constants';
import '../../styles/discovery.css';

function verdictColor(verdict) {
  if (verdict === 'STRONG_YES' || verdict === 'YES') return 'var(--green)';
  if (verdict === 'MAYBE') return 'var(--yellow)';
  if (verdict === 'NO' || verdict === 'STRONG_NO') return 'var(--red)';
  if (verdict === 'MATCH_FAILED') return 'var(--red)';
  return 'var(--text-dim)';
}

export default function RunDetail() {
  const { runId } = useParams();
  const [run, setRun] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rescoringIds, setRescoringIds] = useState(() => new Set());
  const [bulkRescoring, setBulkRescoring] = useState(false);
  const pollRef = useRef(null);

  async function load() {
    try {
      const r = await discoveryApi(`/runs/${runId}`);
      setRun(r);
      const j = await discoveryApi(`/runs/${runId}/jobs`);
      setJobs(j);
      setLoading(false);
      return r.status;
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return 'error';
    }
  }

  useEffect(() => {
    load().then((status) => {
      if (status === 'pending' || status === 'scraping' || status === 'scoring') {
        pollRef.current = setInterval(async () => {
          const s = await load();
          if (s === 'completed' || s === 'failed' || s === 'error') {
            clearInterval(pollRef.current);
          }
        }, 5000);
      }
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [runId]);

  async function saveJob(jobId) {
    try {
      await discoveryApi(`/jobs/${jobId}/save`, { method: 'POST' });
      load();
    } catch (e) {
      alert('שמירה נכשלה: ' + e.message);
    }
  }

  async function dismissJob(jobId) {
    try {
      await discoveryApi(`/jobs/${jobId}/dismiss`, { method: 'POST' });
      load();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  async function rescoreJob(jobId) {
    setRescoringIds((prev) => new Set(prev).add(jobId));
    try {
      await discoveryApi(`/jobs/${jobId}/rescore`, { method: 'POST' });
      await load();
    } catch (e) {
      alert('דירוג מחדש נכשל: ' + e.message);
    } finally {
      setRescoringIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  }

  async function rescoreAllFailed() {
    // Sequential, not parallel — the API is the bottleneck and the whole
    // reason we're here is that it was struggling. Firing 12 requests at
    // once would just re-trigger the rate-limit cascade.
    const failed = visibleJobs.filter(isRescorable);
    if (failed.length === 0) return;
    if (!confirm(`לדרג מחדש ${failed.length} משרות שנכשלו?`)) return;
    setBulkRescoring(true);
    for (const j of failed) {
      try {
        await discoveryApi(`/jobs/${j.id}/rescore`, { method: 'POST' });
      } catch (e) {
        // On the first transport failure we assume the API is still down
        // and stop — no sense pushing the whole list through.
        alert(`דירוג מחדש נעצר: ${e.message}`);
        break;
      }
    }
    setBulkRescoring(false);
    load();
  }

  if (loading) return (
    <div className="discovery-page">
      <RunDetailLoadingSkeleton />
    </div>
  );
  if (error) return <div className="discovery-page"><div className="match-error">{error}</div></div>;
  if (!run) return null;

  const statusMap = { pending: 'ממתין', scraping: 'סורק משרות...', scoring: 'מדרג עם AI...', completed: 'הושלם', failed: 'נכשל' };
  const isActive = run.status === 'pending' || run.status === 'scraping' || run.status === 'scoring';
  const visibleJobs = jobs.filter((j) => !j.dismissed && !j.is_duplicate);
  // A job is rescorable if it has no score yet and either failed at the API
  // (MATCH_FAILED) or was tagged INSUFFICIENT_DATA but has a substantive
  // description (legacy pre-fix runs often mistagged API failures as
  // INSUFFICIENT_DATA). The 50-char floor matches match_client's own guard.
  const isRescorable = (j) =>
    j.score == null && (
      j.verdict === 'MATCH_FAILED' ||
      (j.verdict === 'INSUFFICIENT_DATA' && (j.description?.length || 0) >= 50)
    );
  const failedCount = visibleJobs.filter(isRescorable).length;

  return (
    <div className="discovery-page">
      <Link to="/discovery" className="back-link">&larr; חזרה לגילוי משרות</Link>

      <div className="card run-detail-header">
        <h2>{run.criteria_name}</h2>
        <div className="run-detail-stats">
          <span className={`run-status ${run.status === 'completed' ? 'status-green' : run.status === 'failed' ? 'status-red' : 'status-yellow'}`}>
            {statusMap[run.status] || run.status}
          </span>
          <span>נסרקו: {run.jobs_scraped}</span>
          <span>דורגו: {run.jobs_scored}</span>
          <span>נשמרו: {run.jobs_saved}</span>
          <span>כפילויות: {run.jobs_skipped_duplicate}</span>
        </div>
        {isActive && <div className="match-loading">מעבד... הדף יתעדכן אוטומטית</div>}
        {run.error && <div className="match-error">{run.error}</div>}
        {!isActive && failedCount > 0 && (
          <div className="rescore-banner">
            <span>{failedCount} משרות לא דורגו — ניתן לנסות שוב</span>
            <button
              className="btn btn-sm btn-primary"
              onClick={rescoreAllFailed}
              disabled={bulkRescoring}
            >
              {bulkRescoring ? 'מדרג מחדש...' : 'דרג הכל מחדש'}
            </button>
          </div>
        )}
      </div>

      {visibleJobs.length === 0 && !isActive ? (
        <p className="empty-state">לא נמצאו משרות</p>
      ) : (
        <div className="jobs-list">
          {visibleJobs.map((j) => (
            <div key={j.id} className="job-card">
              <div className="job-card__header">
                <div>
                  <h3 className="job-card__title">{j.title}</h3>
                  <div className="job-card__company">{j.company}</div>
                  {j.location && <div className="job-card__location">{j.location}</div>}
                </div>
                <div className="job-card__score-block">
                  {j.score != null ? (
                    <>
                      <div className="job-card__score" style={{ color: verdictColor(j.verdict) }}>{j.score}</div>
                      <div className="job-card__verdict" style={{ color: verdictColor(j.verdict) }}>{VERDICT_HE[j.verdict] || j.verdict || '-'}</div>
                    </>
                  ) : (
                    <div className="job-card__verdict" style={{ color: 'var(--text-dim)' }}>{VERDICT_HE[j.verdict] || j.verdict || '-'}</div>
                  )}
                </div>
              </div>

              {j.key_strengths?.length > 0 && (
                <div className="job-card__tags">
                  {j.key_strengths.map((s, i) => <span key={i} className="match-flag green">{s}</span>)}
                </div>
              )}
              {j.key_concerns?.length > 0 && (
                <div className="job-card__tags">
                  {j.key_concerns.map((c, i) => <span key={i} className="match-flag red">{c}</span>)}
                </div>
              )}

              {j.honest_assessment && (
                <div className="job-card__assessment">{j.honest_assessment}</div>
              )}

              <div className="job-card__actions">
                {j.job_url && <a href={j.job_url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-secondary">צפה במשרה</a>}
                {isRescorable(j) && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => rescoreJob(j.id)}
                    disabled={rescoringIds.has(j.id) || bulkRescoring}
                  >
                    {rescoringIds.has(j.id) ? 'מדרג...' : 'דרג מחדש'}
                  </button>
                )}
                {!j.saved_to_tracker && j.score != null && (
                  <button className="btn btn-sm btn-primary" onClick={() => saveJob(j.id)}>שמור למעקב</button>
                )}
                {j.saved_to_tracker && <span className="saved-badge">נשמר</span>}
                <button className="btn btn-sm btn-danger" onClick={() => dismissJob(j.id)}>הסתר</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunDetailLoadingSkeleton() {
  return (
    <div className="discovery-loading discovery-loading--run" role="status" aria-live="polite" aria-label="טוען פרטי ריצה">
      <div className="discovery-loading__back skeleton skeleton-back" aria-hidden="true" />

      <div className="discovery-loading__run-header" aria-hidden="true">
        <div className="skeleton skeleton-run-title" />
        <div className="discovery-loading__run-meta">
          <span className="skeleton skeleton-status" />
          <span className="skeleton skeleton-stat-pill" />
          <span className="skeleton skeleton-stat-pill" />
          <span className="skeleton skeleton-stat-pill" />
          <span className="skeleton skeleton-stat-pill" />
        </div>
        <div className="discovery-loading__track" aria-hidden="true">
          <span className="discovery-loading__track-wipe" />
        </div>
      </div>

      <div className="discovery-loading__jobs">
        {[0, 1, 2].map((i) => (
          <div key={i} className="discovery-loading__job-card" style={{ '--i': i }} aria-hidden="true">
            <div className="discovery-loading__job-row">
              <div className="discovery-loading__job-titles">
                <div className="skeleton skeleton-job-title" />
                <div className="skeleton skeleton-job-company" />
                <div className="skeleton skeleton-job-location" />
              </div>
              <div className="discovery-loading__job-score">
                <div className="skeleton skeleton-score" />
                <div className="skeleton skeleton-verdict" />
              </div>
            </div>
            <div className="discovery-loading__job-tags">
              <span className="skeleton skeleton-tag" />
              <span className="skeleton skeleton-tag skeleton-tag--sm" />
              <span className="skeleton skeleton-tag" />
            </div>
            <div className="skeleton skeleton-line skeleton-line--full" />
            <div className="skeleton skeleton-line skeleton-line--long" />
          </div>
        ))}
      </div>

      <div className="discovery-loading__subtitle">
        <span className="discovery-loading__glyph" aria-hidden="true">§</span>
        <span className="discovery-loading__cycle" aria-hidden="true">
          <span className="discovery-loading__cycle-item">מאחזר את הריצה</span>
          <span className="discovery-loading__cycle-item">טוען משרות מדורגות</span>
          <span className="discovery-loading__cycle-item">ממיין לפי ציון</span>
        </span>
        <span className="sr-only">טוען</span>
      </div>
    </div>
  );
}
