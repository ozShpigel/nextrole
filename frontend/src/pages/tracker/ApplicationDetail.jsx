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
    if (!confirm('למחוק את המשרה? כל הראיונות וההערות ימחקו גם כן.')) return;
    try {
      await api(`/applications/${id}`, { method: 'DELETE' });
      window.history.back();
    } catch (e) {
      alert('מחיקה נכשלה: ' + e.message);
    }
  }

  if (!data) return (
    <div className="min-h-[calc(100vh-56px)] bg-bg-deep animate-page-in-fast">
      <div className="max-w-[1100px] mx-auto px-6 pb-8">
        <ApplicationDetailLoadingSkeleton />
      </div>
    </div>
  );

  const { application: app, interviews, notes, statusUpdates } = data;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-bg-deep animate-page-in-fast">
      <div className="max-w-[1100px] mx-auto px-6 pb-8">
        <Link to="/tracker" state={{ tab: 'list' }} className="text-accent cursor-pointer text-[0.88rem] mb-5 inline-flex items-center gap-[0.4rem] font-medium transition-all hover:text-accent-hover hover:gap-[0.6rem]">&larr; חזרה לרשימה</Link>

        {/* Header */}
        <div className="bg-bg-card border border-border rounded-lg p-6 mb-4 shadow-sm transition-all hover:border-border-strong hover:shadow-md">
          <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
            <div>
              <h2 className="text-text-bright mb-1 text-[1.3rem] font-bold tracking-[-0.01em]">{app.jobTitle}</h2>
              <div className="text-text-secondary text-[0.95rem]">{app.company}</div>
              <div className="mt-4"><StatusBadge status={app.status} /></div>
            </div>
            <div className="text-center">
              <div className="font-sans text-[2.2rem] font-bold tracking-[-0.02em]" style={{ color: scoreColor(app.matchScore) }}>{app.matchScore ?? '-'}</div>
              <div className="text-text-dim text-[0.84rem]">{app.matchVerdict || ''}</div>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap mt-4">
            <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.35rem] px-[0.85rem] border-none rounded-lg cursor-pointer text-[0.78rem] font-semibold font-sans transition-all relative overflow-hidden bg-gradient-to-br from-accent to-accent-hover text-white shadow-[0_1px_3px_rgba(168,130,86,0.2)] hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(168,130,86,0.25),var(--shadow-glow)]" onClick={() => setModal({ type: 'status' })}>עדכן סטטוס</button>
            <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.35rem] px-[0.85rem] border rounded-lg cursor-pointer text-[0.78rem] font-medium font-sans transition-all bg-bg-card text-text-primary border-border-strong hover:border-border-hover hover:shadow-sm" onClick={() => setModal({ type: 'interview' })}>הוסף ראיון</button>
            <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.35rem] px-[0.85rem] border rounded-lg cursor-pointer text-[0.78rem] font-medium font-sans transition-all bg-bg-card text-text-primary border-border-strong hover:border-border-hover hover:shadow-sm" onClick={() => setModal({ type: 'note' })}>הוסף הערה</button>
            <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.35rem] px-[0.85rem] rounded-lg cursor-pointer text-[0.78rem] font-medium font-sans transition-all bg-red-bg text-red border border-[rgba(196,84,84,0.12)] hover:bg-[rgba(196,84,84,0.1)] hover:border-[rgba(196,84,84,0.2)]" onClick={deleteApp}>מחק</button>
          </div>
        </div>

        {/* AI Analysis */}
        <AnalysisCard matchAnalysisJson={app.matchAnalysis} />

        {/* Raw Claude call artifacts */}
        {(app.analystSnapshotInput || app.evaluatorSnapshotInput) && (
          <CollapsibleSection title="קריאות Claude גולמיות" defaultOpen={false}>
            <SnapshotsCard snapshots={{
              analystInput:    app.analystSnapshotInput,
              analystOutput:   app.analystSnapshotOutput,
              evaluatorInput:  app.evaluatorSnapshotInput,
              evaluatorOutput: app.evaluatorSnapshotOutput,
            }} />
          </CollapsibleSection>
        )}

        {/* Timeline */}
        <div className="bg-bg-card border border-border rounded-lg p-6 mb-4 shadow-sm transition-all hover:border-border-strong hover:shadow-md">
          <h3 className="text-[0.95rem] font-semibold text-text-bright mb-3 pb-[0.6rem] border-b border-border">ציר זמן</h3>
          <Timeline statusUpdates={statusUpdates} interviews={interviews} notes={notes} />
        </div>

        {/* Interviews */}
        <CollapsibleSection title={`ראיונות (${interviews.length})`}>
          <InterviewList
            interviews={interviews}
            onEdit={(i) => setModal({ type: 'editInterview', data: i })}
            onRefresh={load}
          />
        </CollapsibleSection>

        {/* Notes */}
        <CollapsibleSection title={`הערות (${notes.length})`}>
          <NoteList notes={notes} onRefresh={load} />
        </CollapsibleSection>

        {/* Job Description */}
        {app.jobDescription && (
          <CollapsibleSection title="תיאור המשרה" defaultOpen={false}>
            <pre className="whitespace-pre-wrap font-sans text-[0.85rem] text-text-dim">{app.jobDescription}</pre>
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
    <div className="animate-page-in pb-4 relative" role="status" aria-live="polite" aria-label="טוען פרטי משרה">
      <div className="skeleton w-[120px] h-[14px] rounded mb-5" aria-hidden="true" />

      {/* Hero card */}
      <div
        className="bg-bg-card border border-border rounded-lg p-6 mb-4 shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden pb-5"
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
        <div className="mt-[1.1rem] h-px relative overflow-hidden" style={{ background: 'linear-gradient(to left, transparent, rgba(168,130,86,0.18) 50%, transparent)' }}>
          <span className="absolute top-[-1px] bottom-[-1px] w-[28%] animate-track-sweep" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(168,130,86,0.55) 50%, transparent 100%)', filter: 'blur(0.5px)', boxShadow: '0 0 6px rgba(168,130,86,0.3)' }} />
        </div>
      </div>

      {/* Analysis card skeleton */}
      <div
        className="bg-bg-card border border-border rounded-lg p-6 mb-4 shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden"
        style={{ animation: 'cardRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both', animationDelay: '70ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <span className="font-serif text-[0.78rem] font-bold text-accent tracking-[0.14em] py-[0.18rem] px-2 border border-[rgba(168,130,86,0.2)] rounded bg-[rgba(168,130,86,0.05)] tabular-nums">A</span>
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
        className="bg-bg-card border border-border rounded-lg p-6 mb-4 shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden"
        style={{ animation: 'cardRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both', animationDelay: '140ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <span className="font-serif text-[0.78rem] font-bold text-accent tracking-[0.14em] py-[0.18rem] px-2 border border-[rgba(168,130,86,0.2)] rounded bg-[rgba(168,130,86,0.05)] tabular-nums">§</span>
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
      <div className="mt-9 pt-5 border-t border-dashed border-[rgba(120,100,70,0.14)] flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-text-secondary italic tracking-[-0.005em] relative">
        <div className="absolute top-[-1px] start-0 w-[36px] h-px bg-accent opacity-50" />
        <span className="font-serif text-[1.15rem] text-accent opacity-75 not-italic" aria-hidden="true">§</span>
        <span className="relative inline-block h-[1.4em] min-w-[22ch]" aria-hidden="true">
          <span className="absolute inset-0 start-0 opacity-0 translate-y-[6px] whitespace-nowrap" style={{ animation: 'cycleFade 6s cubic-bezier(0.22, 1, 0.36, 1) infinite', animationDelay: '0s' }}>שולף נתוני משרה</span>
          <span className="absolute inset-0 start-0 opacity-0 translate-y-[6px] whitespace-nowrap" style={{ animation: 'cycleFade 6s cubic-bezier(0.22, 1, 0.36, 1) infinite', animationDelay: '2s' }}>קורא ראיונות והערות</span>
          <span className="absolute inset-0 start-0 opacity-0 translate-y-[6px] whitespace-nowrap" style={{ animation: 'cycleFade 6s cubic-bezier(0.22, 1, 0.36, 1) infinite', animationDelay: '4s' }}>מרכיב את הציר</span>
        </span>
        <span className="sr-only">טוען פרטי משרה</span>
      </div>
    </div>
  );
}
