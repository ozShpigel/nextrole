import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { scoreColor } from '../../utils/format';
import StatusBadge from '../../components/StatusBadge';
import CollapsibleSection from '../../components/CollapsibleSection';
import SnapshotsCard from '../../components/SnapshotsCard';
import AnalysisCard from './AnalysisCard';
import Timeline from './Timeline';
import InterviewList from './InterviewList';
import NoteList from './NoteList';
import StatusModal from './StatusModal';
import InterviewModal from './InterviewModal';
import NoteModal from './NoteModal';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ApplicationDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(null); // { type: 'status'|'interview'|'editInterview'|'note', data? }

  const load = useCallback(async () => {
    try {
      setData(await api(`/applications/${id}`));
    } catch (e) {
      console.error('Detail error:', e);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function closeAndReload() {
    setModal(null);
    load();
  }

  async function deleteApp() {
    if (!confirm('Delete this application? All interviews and notes will also be deleted.')) return;
    try {
      await api(`/applications/${id}`, { method: 'DELETE' });
      window.history.back();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }

  if (!data) return (
    <div className="min-h-[calc(100vh-56px)] bg-background animate-page-in-fast">
      <div className="max-w-[1100px] mx-auto px-6 pb-8">
        <ApplicationDetailLoadingSkeleton />
      </div>
    </div>
  );

  const { application: app, interviews, notes, statusUpdates } = data;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-background animate-page-in-fast">
      <div className="max-w-[1100px] mx-auto px-6 pb-8">
        <Link to="/tracker" state={{ tab: 'list' }} className="text-primary cursor-pointer text-[0.88rem] mb-5 inline-flex items-center gap-[0.4rem] font-medium transition-all hover:text-primary/80 hover:gap-[0.6rem]">&larr; Back to List</Link>

        {/* Header */}
        <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
          <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
            <div>
              <h2 className="text-foreground mb-1 text-[1.3rem] font-bold tracking-[-0.01em]">{app.jobTitle}</h2>
              <div className="text-muted-foreground text-[0.95rem]">{app.company}</div>
              <div className="mt-4"><StatusBadge status={app.status} /></div>
            </div>
            <div className="text-center">
              <div className="font-sans text-[2.2rem] font-bold tracking-[-0.02em]" style={{ color: scoreColor(app.matchScore) }}>{app.matchScore ?? '-'}</div>
              <div className="text-muted-foreground text-[0.84rem]">{app.matchVerdict || ''}</div>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap mt-4">
            <Button onClick={() => setModal({ type: 'status' })}>Update Status</Button>
            <Button variant="outline" onClick={() => setModal({ type: 'interview' })}>Add Interview</Button>
            <Button variant="outline" onClick={() => setModal({ type: 'note' })}>Add Note</Button>
            <Button variant="destructive" onClick={deleteApp}>Delete</Button>
          </div>
        </Card>

        {/* AI Analysis */}
        <AnalysisCard matchAnalysisJson={app.matchAnalysis} />

        {/* Raw Claude call artifacts */}
        {(app.analystSnapshotInput || app.evaluatorSnapshotInput) && (
          <CollapsibleSection title="Raw Claude Calls" defaultOpen={false}>
            <SnapshotsCard snapshots={{
              analystInput:    app.analystSnapshotInput,
              analystOutput:   app.analystSnapshotOutput,
              evaluatorInput:  app.evaluatorSnapshotInput,
              evaluatorOutput: app.evaluatorSnapshotOutput,
            }} />
          </CollapsibleSection>
        )}

        {/* Timeline */}
        <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
          <h3 className="text-[0.95rem] font-semibold text-foreground mb-3 pb-[0.6rem] border-b border-border">Timeline</h3>
          <Timeline statusUpdates={statusUpdates} interviews={interviews} notes={notes} />
        </Card>

        {/* Interviews */}
        <CollapsibleSection title={`Interviews (${interviews.length})`}>
          <InterviewList
            interviews={interviews}
            onEdit={(i) => setModal({ type: 'editInterview', data: i })}
            onRefresh={load}
          />
        </CollapsibleSection>

        {/* Notes */}
        <CollapsibleSection title={`Notes (${notes.length})`}>
          <NoteList notes={notes} onRefresh={load} />
        </CollapsibleSection>

        {/* Job Description */}
        {app.jobDescription && (
          <CollapsibleSection title="Job Description" defaultOpen={false}>
            <pre className="whitespace-pre-wrap font-sans text-[0.85rem] text-muted-foreground">{app.jobDescription}</pre>
          </CollapsibleSection>
        )}

        {/* Modals */}
        {modal?.type === 'status' && (
          <StatusModal appId={app.id} currentStatus={app.status} onClose={() => setModal(null)} onSaved={closeAndReload} />
        )}
        {modal?.type === 'interview' && (
          <InterviewModal appId={app.id} onClose={() => setModal(null)} onSaved={closeAndReload} />
        )}
        {modal?.type === 'editInterview' && (
          <InterviewModal appId={app.id} interview={modal.data} onClose={() => setModal(null)} onSaved={closeAndReload} />
        )}
        {modal?.type === 'note' && (
          <NoteModal appId={app.id} onClose={() => setModal(null)} onSaved={closeAndReload} />
        )}
      </div>
    </div>
  );
}

function ApplicationDetailLoadingSkeleton() {
  return (
    <div className="animate-page-in pb-4 relative" role="status" aria-live="polite" aria-label="Loading application details">
      <div className="skeleton w-[120px] h-[14px] rounded mb-5" aria-hidden="true" />

      {/* Hero card */}
      <div
        className="bg-card border border-border rounded-lg p-6 mb-4 shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden pb-5"
        style={{ animation: 'cardRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both', animationDelay: '0ms' }}
        aria-hidden="true"
      >
        <div className="flex justify-between items-start gap-6 flex-wrap">
          <div className="flex-1 min-w-0 flex flex-col gap-[0.55rem]">
            <span className="skeleton w-[62%] h-[22px] rounded" />
            <span className="skeleton w-[40%] h-[14px] rounded" />
            <span className="skeleton w-[86px] h-[22px] rounded-sm" />
          </div>
          <div className="flex flex-col items-center gap-[0.4rem] shrink-0">
            <span className="skeleton w-[64px] h-[42px] rounded-sm" />
            <span className="skeleton w-[72px] h-[12px] rounded" />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap mt-[0.4rem]">
          <span className="skeleton w-[96px] h-[32px] rounded-lg" />
          <span className="skeleton w-[96px] h-[32px] rounded-lg" />
          <span className="skeleton w-[96px] h-[32px] rounded-lg" />
          <span className="skeleton w-[64px] h-[32px] rounded-lg" />
        </div>
        <div className="mt-[1.1rem] h-px relative overflow-hidden" style={{ background: 'linear-gradient(to left, transparent, rgba(163,163,163,0.18) 50%, transparent)' }}>
          <span className="absolute top-[-1px] bottom-[-1px] w-[28%] animate-track-sweep" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(163,163,163,0.55) 50%, transparent 100%)', filter: 'blur(0.5px)', boxShadow: '0 0 6px rgba(163,163,163,0.3)' }} />
        </div>
      </div>

      {/* Analysis card skeleton */}
      <div
        className="bg-card border border-border rounded-lg p-6 mb-4 shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden"
        style={{ animation: 'cardRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both', animationDelay: '70ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <span className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] py-[0.18rem] px-2 border border-border rounded bg-muted/50 tabular-nums">A</span>
          <span className="skeleton flex-1 max-w-[200px] h-[14px] rounded" />
        </div>
        <div className="flex flex-wrap gap-[0.4rem] mb-1">
          <span className="skeleton inline-block w-[96px] h-[22px] rounded-full" />
          <span className="skeleton inline-block w-[62px] h-[22px] rounded-full" />
          <span className="skeleton inline-block w-[96px] h-[22px] rounded-full" />
          <span className="skeleton inline-block w-[62px] h-[22px] rounded-full" />
        </div>
        <span className="skeleton w-full h-[12px] rounded" />
        <span className="skeleton w-[70%] h-[12px] rounded" />
        <span className="skeleton w-[45%] h-[12px] rounded" />
      </div>

      {/* Timeline card skeleton */}
      <div
        className="bg-card border border-border rounded-lg p-6 mb-4 shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden"
        style={{ animation: 'cardRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both', animationDelay: '140ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <span className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] py-[0.18rem] px-2 border border-border rounded bg-muted/50 tabular-nums">§</span>
          <span className="skeleton flex-1 max-w-[200px] h-[14px] rounded" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 py-3 border-b border-border items-start last:border-b-0">
            <span className="skeleton w-[34px] h-[34px] rounded-[9px] shrink-0" />
            <div className="flex-1 flex flex-col gap-[0.4rem]">
              <span className="skeleton w-[70%] h-[12px] rounded" />
              <span className="skeleton w-[45%] h-[12px] rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* Cycling subtitle */}
      <div className="mt-9 pt-5 border-t border-dashed border-border flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-muted-foreground italic tracking-[-0.005em] relative">
        <div className="absolute top-[-1px] left-0 w-[36px] h-px bg-primary opacity-50" />
        <span className="font-serif text-[1.15rem] text-primary opacity-75 not-italic" aria-hidden="true">§</span>
        <span className="relative inline-block h-[1.4em] min-w-[22ch]" aria-hidden="true">
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] whitespace-nowrap" style={{ animation: 'cycleFade 6s cubic-bezier(0.22, 1, 0.36, 1) infinite', animationDelay: '0s' }}>Fetching application data</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] whitespace-nowrap" style={{ animation: 'cycleFade 6s cubic-bezier(0.22, 1, 0.36, 1) infinite', animationDelay: '2s' }}>Loading interviews and notes</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] whitespace-nowrap" style={{ animation: 'cycleFade 6s cubic-bezier(0.22, 1, 0.36, 1) infinite', animationDelay: '4s' }}>Building timeline</span>
        </span>
        <span className="sr-only">Loading application details</span>
      </div>
    </div>
  );
}
