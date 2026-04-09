import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';
import { formatDate, scoreColor } from '../../utils/format';
import StatusBadge from '../../components/StatusBadge';

export default function ApplicationList() {
  const [apps, setApps] = useState([]);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setApps(await api('/applications'));
    } catch (e) {
      console.error('List error:', e);
    }
  }

  async function deleteApp(id) {
    if (!confirm('למחוק את המשרה? כל הראיונות וההערות ימחקו גם כן.')) return;
    try {
      await api(`/applications/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert('מחיקה נכשלה: ' + e.message);
    }
  }

  if (apps.length === 0) {
    return <div className="card"><p className="empty-state">אין משרות עדיין. הוסף משרה חדשה!</p></div>;
  }

  return (
    <div className="card">
      <div className="list-header">
        <span>תפקיד</span>
        <span>חברה</span>
        <span>סטטוס</span>
        <span>ציון</span>
        <span>תאריך</span>
        <span></span>
      </div>
      {apps.map((a) => (
        <div key={a.id} className="app-row" onClick={() => navigate(`/tracker/${a.id}`)}>
          <div><div className="title">{a.jobTitle}</div></div>
          <div className="company">{a.company}</div>
          <div><StatusBadge status={a.status} /></div>
          <div className="score" style={{ color: scoreColor(a.matchScore) }}>{a.matchScore ?? '-'}</div>
          <div className="date">{formatDate(a.createdAt)}</div>
          <div style={{ justifySelf: 'end' }}>
            <button
              className="btn btn-danger btn-sm"
              onClick={(e) => { e.stopPropagation(); deleteApp(a.id); }}
            >
              מחק
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
