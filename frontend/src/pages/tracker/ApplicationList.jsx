import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';
import { formatDate, scoreColor } from '../../utils/format';
import StatusBadge from '../../components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ApplicationList() {
  const [apps, setApps] = useState([]);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setApps(await api('/applications'));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteApp(id) {
    if (!confirm('Delete this application? All interviews and notes will also be deleted.')) return;
    try {
      await api(`/applications/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }

  if (error) {
    return <Card className="p-6 mb-4"><p className="text-center py-12 text-destructive text-[0.88rem]">Failed to load applications: {error}</p></Card>;
  }

  if (apps.length === 0) {
    return <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md"><p className="text-center py-12 text-muted-foreground text-[0.88rem]">No applications yet. Add a new application!</p></Card>;
  }

  return (
    <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
      <div className="hidden md:grid grid-cols-[2fr_1.5fr_1fr_0.5fr_0.8fr_0.5fr_minmax(3.5rem,auto)] gap-4 py-[0.6rem] px-5 text-[0.72rem] text-muted-foreground border-b border-border uppercase tracking-[0.07em] font-medium">
        <span>Position</span>
        <span>Company</span>
        <span>Status</span>
        <span>Days</span>
        <span>Score</span>
        <span>Date</span>
        <span></span>
      </div>
      {apps.map((a) => {
        const days = a.updatedAt ? Math.floor((Date.now() - new Date(a.updatedAt).getTime()) / 86400000) : null;
        const daysColor = days >= 14 ? 'var(--red)' : days >= 7 ? 'var(--yellow)' : undefined;
        return (
          <div key={a.id} className="grid grid-cols-[1fr_1fr] md:grid-cols-[2fr_1.5fr_1fr_0.5fr_0.8fr_0.5fr_minmax(3.5rem,auto)] items-center gap-4 py-[0.9rem] px-5 border-b border-border cursor-pointer transition-colors hover:bg-accent last:border-b-0" onClick={() => navigate(`/tracker/${a.id}`)}>
            <div><div className="font-semibold text-foreground text-[0.9rem]">{a.jobTitle}</div></div>
            <div className="text-muted-foreground text-[0.84rem]">{a.company}</div>
            <div><StatusBadge status={a.status} /></div>
            <div className="text-[0.78rem] font-medium" style={{ color: daysColor }}>{days !== null ? `${days}d` : '-'}</div>
            <div className="font-semibold text-[0.88rem]" style={{ color: scoreColor(a.matchScore) }}>{a.matchScore ?? '-'}</div>
            <div className="text-muted-foreground text-[0.78rem]">{formatDate(a.createdAt)}</div>
            <div style={{ justifySelf: 'end' }}>
              <Button
                variant="destructive"
                size="sm"
                onClick={(e) => { e.stopPropagation(); deleteApp(a.id); }}
              >
                Delete
              </Button>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
