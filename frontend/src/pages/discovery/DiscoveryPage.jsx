import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { discoveryApi } from '../../utils/api';
import CriteriaForm from './CriteriaForm';
import '../../styles/discovery.css';

export default function DiscoveryPage() {
  const [criteria, setCriteria] = useState([]);
  const [runs, setRuns] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const c = await discoveryApi('/criteria');
      setCriteria(c);
      const r = await discoveryApi('/runs');
      setRuns(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
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

  function onSaved() {
    setShowForm(false);
    setEditItem(null);
    load();
  }

  function statusLabel(status) {
    const map = {
      pending: 'ממתין',
      scraping: 'סורק...',
      scoring: 'מדרג...',
      completed: 'הושלם',
      failed: 'נכשל',
    };
    return map[status] || status;
  }

  function statusClass(status) {
    if (status === 'completed') return 'status-green';
    if (status === 'failed') return 'status-red';
    if (status === 'scraping' || status === 'scoring') return 'status-yellow';
    return 'status-dim';
  }

  if (loading) return <div className="discovery-page"><p className="empty-state">טוען...</p></div>;

  return (
    <div className="discovery-page">
      <div className="discovery-header">
        <div>
          <h1>גילוי משרות</h1>
          <p className="subtitle">חיפוש אוטומטי של משרות מ-LinkedIn עם דירוג AI</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditItem(null); setShowForm(true); }}>
          + קריטריון חדש
        </button>
      </div>

      {error && <div className="match-error">{error}</div>}

      {showForm && (
        <CriteriaForm
          initial={editItem}
          onSave={onSaved}
          onCancel={() => { setShowForm(false); setEditItem(null); }}
        />
      )}

      {/* Criteria List */}
      <section className="discovery-section">
        <h2 className="section-title">קריטריוני חיפוש</h2>
        {criteria.length === 0 ? (
          <p className="empty-state">אין קריטריוני חיפוש. צור אחד חדש!</p>
        ) : (
          <div className="criteria-grid">
            {criteria.map((c) => (
              <div key={c.id} className="criteria-card">
                <div className="criteria-card__header">
                  <h3>{c.name}</h3>
                  <div className="criteria-card__actions">
                    <button className="btn btn-sm btn-secondary" onClick={() => { setEditItem(c); setShowForm(true); }}>ערוך</button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteCriteria(c.id)}>מחק</button>
                  </div>
                </div>
                <div className="criteria-card__body">
                  <div className="criteria-tags">
                    {c.job_titles.map((t, i) => <span key={i} className="criteria-tag">{t}</span>)}
                  </div>
                  {c.locations.length > 0 && (
                    <div className="criteria-meta">מיקום: {c.locations.join(', ')}</div>
                  )}
                  <div className="criteria-meta">
                    אתרים: {c.site_names.join(', ')} | סף ציון: {c.min_score_to_save}
                  </div>
                  {c.values.length > 0 && (
                    <div className="criteria-values">
                      {c.values.map((v, i) => <span key={i} className="value-tag">{v}</span>)}
                    </div>
                  )}
                </div>
                <button className="btn btn-primary btn-run" onClick={() => triggerRun(c.id)}>
                  הפעל חיפוש
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Runs */}
      <section className="discovery-section">
        <h2 className="section-title">היסטוריית חיפושים</h2>
        {runs.length === 0 ? (
          <p className="empty-state">אין חיפושים עדיין</p>
        ) : (
          <div className="runs-list">
            {runs.map((r) => (
              <div
                key={r.id}
                className="run-card"
                onClick={() => navigate(`/discovery/${r.id}`)}
                style={{ cursor: 'pointer' }}
              >
                <div className="run-card__header">
                  <span className="run-card__name">{r.criteria_name}</span>
                  <span className={`run-status ${statusClass(r.status)}`}>{statusLabel(r.status)}</span>
                </div>
                <div className="run-card__stats">
                  <span>נסרקו: {r.jobs_scraped}</span>
                  <span>דורגו: {r.jobs_scored}</span>
                  <span>נשמרו: {r.jobs_saved}</span>
                  <span>כפילויות: {r.jobs_skipped_duplicate}</span>
                </div>
                <div className="run-card__date">
                  {new Date(r.started_at).toLocaleString('he-IL')}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
