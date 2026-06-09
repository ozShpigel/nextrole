import { useNavigate } from 'react-router-dom';
import { useApplications } from '../lib/queries';
import { useDeleteApplication } from '../lib/mutations';
import { formatDate, verdictColor, verdictLabel } from '../lib/format';
import { StatusBadge } from './Status';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Application {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  matchScore: number | null;
  matchVerdict: string | null;
  createdAt: string;
  updatedAt?: string;
}

export default function ApplicationList() {
  const navigate = useNavigate();
  const { data: apps = [], error } = useApplications();
  const deleteAppMutation = useDeleteApplication();

  if (error) {
    return <Card className="p-6 mb-4"><p className="text-center py-12 text-destructive text-[0.88rem]">Failed to load applications: {error.message}</p></Card>;
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
        <span>Verdict</span>
        <span>Date</span>
        <span></span>
      </div>
      {(apps as Application[]).map((a) => {
        const days = a.updatedAt ? Math.floor((Date.now() - new Date(a.updatedAt).getTime()) / 86400000) : null;
        const daysColor = days !== null && days >= 14 ? '#ef4444' : days !== null && days >= 7 ? '#d97706' : undefined;
        return (
          <div key={a.id} className="grid grid-cols-[1fr_1fr] md:grid-cols-[2fr_1.5fr_1fr_0.5fr_0.8fr_0.5fr_minmax(3.5rem,auto)] items-center gap-4 py-[0.9rem] px-5 border-b border-border cursor-pointer transition-colors hover:bg-accent last:border-b-0" onClick={() => navigate(`/tracker/${a.id}`)}>
            <div><div className="font-semibold text-foreground text-[0.9rem]">{a.jobTitle}</div></div>
            <div className="text-muted-foreground text-[0.84rem]">{a.company}</div>
            <div><StatusBadge status={a.status} /></div>
            <div className="text-[0.78rem] font-medium" style={{ color: daysColor }}>{days !== null ? `${days}d` : '-'}</div>
            <div className="font-semibold text-[0.82rem]" style={{ color: verdictColor(a.matchVerdict) }}>{verdictLabel(a.matchVerdict)}{a.matchScore != null ? <span className="text-muted-foreground font-normal text-[0.72rem] ml-1">({a.matchScore})</span> : ''}</div>
            <div className="text-muted-foreground text-[0.78rem]">{formatDate(a.createdAt)}</div>
            <div style={{ justifySelf: 'end' }}>
              <Button
                variant="destructive"
                size="sm"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (!confirm('Delete this application? All interviews and notes will also be deleted.')) return;
                  deleteAppMutation.mutate(a.id);
                }}
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
