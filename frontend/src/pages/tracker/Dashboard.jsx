import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';
import { formatDate, formatDateTime } from '../../utils/format';
import StatusBadge from '../../components/StatusBadge';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const apps = await api('/applications');
        setRecent(apps.slice(0, 5));
        await new Promise(r => setTimeout(r, 300));
        const s = await api('/stats');
        setStats(s);
        await new Promise(r => setTimeout(r, 300));
        const u = await api('/interviews/upcoming');
        setUpcoming(u);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <DashboardLoadingSkeleton />;
  if (error) return <div className="card"><p className="text-dim">שגיאה בטעינת הנתונים: {error}</p></div>;

  return (
    <>
      {stats && (
        <div className="summary-grid">
          <div className="summary-card"><div className="value">{stats.total}</div><div className="label">סה&quot;כ משרות</div></div>
          <div className="summary-card"><div className="value">{stats.inProgress}</div><div className="label">בתהליך</div></div>
          <div className="summary-card"><div className="value">{stats.avgScore || '-'}</div><div className="label">ציון ממוצע</div></div>
          <div className="summary-card"><div className="value">{stats.responseRate}%</div><div className="label">אחוז מענה</div></div>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">ראיונות קרובים</h3>
        {upcoming.length === 0 ? (
          <p className="empty-state">אין ראיונות קרובים</p>
        ) : (
          upcoming.map((u, i) => (
            <div key={i} className="item-card">
              <div className="item-header">
                <span className="item-title">{u.interview.type} - {u.company || ''}</span>
                <span className="item-meta">{formatDateTime(u.interview.scheduledAt)}</span>
              </div>
              <div className="item-body text-dim">{u.jobTitle || ''} {u.interview.interviewer ? `| ${u.interview.interviewer}` : ''}</div>
            </div>
          ))
        )}
      </div>

      <div className="card mt-1">
        <h3 className="section-title">פעילות אחרונה</h3>
        {recent.length === 0 ? (
          <p className="empty-state">אין פעילות אחרונה</p>
        ) : (
          recent.map((a) => (
            <div key={a.id} className="timeline-item" style={{ cursor: 'pointer' }} onClick={() => navigate(`/tracker/${a.id}`)}>
              <div className="timeline-icon status">&#x1F4CB;</div>
              <div className="timeline-content">
                <div className="timeline-text"><strong>{a.jobTitle}</strong> - {a.company} <StatusBadge status={a.status} /></div>
                <div className="timeline-date">{formatDate(a.createdAt)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

const DASHBOARD_HERO_LETTERS = ['ד', 'ש', 'ב', 'ו', 'ר', 'ד'];

function DashboardLoadingSkeleton() {
  return (
    <div className="tracker-loading" role="status" aria-live="polite" aria-label="טוען דשבורד">
      <header className="tracker-loading__hero" aria-hidden="true">
        <span className="tracker-loading__eyebrow">Overview · 2026</span>
        <h2 className="tracker-loading__title">
          {DASHBOARD_HERO_LETTERS.map((ch, i) => (
            <span key={i} className="tracker-loading__title-letter" style={{ '--i': i }}>{ch}</span>
          ))}
        </h2>
        <div className="tracker-loading__track">
          <span className="tracker-loading__track-wipe" />
        </div>
      </header>

      <div className="tracker-loading__summary" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="tracker-loading__summary-card" style={{ '--i': i }}>
            <span className="skeleton skeleton-value" />
            <span className="skeleton skeleton-label" />
          </div>
        ))}
      </div>

      <div className="tracker-loading__card" style={{ '--i': 4 }} aria-hidden="true">
        <div className="tracker-loading__section-head">
          <span className="tracker-loading__section-num">01</span>
          <span className="skeleton skeleton-section-title" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="tracker-loading__item">
            <div className="tracker-loading__item-row">
              <span className="skeleton skeleton-item-title" />
              <span className="skeleton skeleton-item-meta" />
            </div>
            <span className="skeleton skeleton-line skeleton-line--long" />
          </div>
        ))}
      </div>

      <div className="tracker-loading__card" style={{ '--i': 5 }} aria-hidden="true">
        <div className="tracker-loading__section-head">
          <span className="tracker-loading__section-num">02</span>
          <span className="skeleton skeleton-section-title" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="tracker-loading__timeline-item">
            <span className="skeleton skeleton-icon" />
            <div className="tracker-loading__timeline-body">
              <span className="skeleton skeleton-line skeleton-line--long" />
              <span className="skeleton skeleton-line skeleton-line--short" />
            </div>
          </div>
        ))}
      </div>

      <div className="tracker-loading__subtitle">
        <span className="tracker-loading__glyph" aria-hidden="true">§</span>
        <span className="tracker-loading__cycle" aria-hidden="true">
          <span className="tracker-loading__cycle-item">מאחזר משרות פעילות</span>
          <span className="tracker-loading__cycle-item">מסכם סטטיסטיקות</span>
          <span className="tracker-loading__cycle-item">ממפה ראיונות קרובים</span>
        </span>
        <span className="sr-only">טוען דשבורד</span>
      </div>
    </div>
  );
}
