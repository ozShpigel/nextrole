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
    return <div className="bg-bg-card border border-border rounded-lg p-6 mb-4 shadow-sm transition-all hover:border-border-strong hover:shadow-md"><p className="text-center py-12 text-text-dim text-[0.88rem]">אין משרות עדיין. הוסף משרה חדשה!</p></div>;
  }

  return (
    <div className="bg-bg-card border border-border rounded-lg p-6 mb-4 shadow-sm transition-all hover:border-border-strong hover:shadow-md">
      <div className="hidden md:grid grid-cols-[2fr_1.5fr_1fr_0.8fr_0.5fr_minmax(3.5rem,auto)] gap-4 py-[0.6rem] px-5 text-[0.72rem] text-text-dim border-b border-border-strong uppercase tracking-[0.07em] font-medium">
        <span>תפקיד</span>
        <span>חברה</span>
        <span>סטטוס</span>
        <span>ציון</span>
        <span>תאריך</span>
        <span></span>
      </div>
      {apps.map((a) => (
        <div key={a.id} className="grid grid-cols-[1fr_1fr] md:grid-cols-[2fr_1.5fr_1fr_0.8fr_0.5fr_minmax(3.5rem,auto)] items-center gap-4 py-[0.9rem] px-5 border-b border-border cursor-pointer transition-colors hover:bg-accent-glow last:border-b-0" onClick={() => navigate(`/tracker/${a.id}`)}>
          <div><div className="font-semibold text-text-bright text-[0.9rem]">{a.jobTitle}</div></div>
          <div className="text-text-secondary text-[0.84rem]">{a.company}</div>
          <div><StatusBadge status={a.status} /></div>
          <div className="font-semibold text-[0.88rem]" style={{ color: scoreColor(a.matchScore) }}>{a.matchScore ?? '-'}</div>
          <div className="text-text-dim text-[0.78rem]">{formatDate(a.createdAt)}</div>
          <div style={{ justifySelf: 'end' }}>
            <button
              className="inline-flex items-center justify-center gap-[0.4rem] py-[0.35rem] px-[0.85rem] border rounded-lg cursor-pointer text-[0.78rem] font-medium font-sans transition-all bg-red-bg text-red border-[rgba(196,84,84,0.12)] hover:bg-[rgba(196,84,84,0.1)] hover:border-[rgba(196,84,84,0.2)]"
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
