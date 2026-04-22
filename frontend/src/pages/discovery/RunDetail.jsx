import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { discoveryApi } from '../../utils/api';
import { VERDICT_HE } from '../../utils/constants';
import '../../styles/discovery.css';

function verdictColor(verdict) {
  if (verdict === 'STRONG_YES' || verdict === 'YES') return 'var(--green)';
  if (verdict === 'MAYBE') return 'var(--yellow)';
  if (verdict === 'NO' || verdict === 'STRONG_NO') return 'var(--red)';
  return 'var(--text-dim)';
}

export default function RunDetail() {
  const { runId } = useParams();
  const [run, setRun] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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

  if (loading) return <div className="discovery-page"><p className="empty-state">טוען...</p></div>;
  if (error) return <div className="discovery-page"><div className="match-error">{error}</div></div>;
  if (!run) return null;

  const statusMap = { pending: 'ממתין', scraping: 'סורק משרות...', scoring: 'מדרג עם AI...', completed: 'הושלם', failed: 'נכשל' };
  const isActive = run.status === 'pending' || run.status === 'scraping' || run.status === 'scoring';
  const visibleJobs = jobs.filter((j) => !j.dismissed && !j.is_duplicate);

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
