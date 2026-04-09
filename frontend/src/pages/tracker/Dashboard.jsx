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
        const s = await api('/stats');
        setStats(s);
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

  if (loading) return <p className="empty-state">טוען...</p>;
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
