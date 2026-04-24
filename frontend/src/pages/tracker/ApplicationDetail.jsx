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
import '../../styles/tracker.css';

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
    <div className="tracker">
      <div className="container">
        <ApplicationDetailLoadingSkeleton />
      </div>
    </div>
  );

  const { application: app, interviews, notes, statusUpdates } = data;

  return (
    <div className="tracker">
      <div className="container">
        <Link to="/tracker" state={{ tab: 'list' }} className="back-link">&larr; חזרה לרשימה</Link>

        {/* Header */}
        <div className="card">
          <div className="detail-header">
            <div>
              <h2>{app.jobTitle}</h2>
              <div className="company-name">{app.company}</div>
              <div className="mt-1"><StatusBadge status={app.status} /></div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="detail-score" style={{ color: scoreColor(app.matchScore) }}>{app.matchScore ?? '-'}</div>
              <div className="text-dim text-sm">{app.matchVerdict || ''}</div>
            </div>
          </div>

          <div className="btn-group mt-1">
            <button className="btn btn-primary btn-sm" onClick={() => setModal({ type: 'status' })}>עדכן סטטוס</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setModal({ type: 'interview' })}>הוסף ראיון</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setModal({ type: 'note' })}>הוסף הערה</button>
            <button className="btn btn-danger btn-sm" onClick={deleteApp}>מחק</button>
          </div>
        </div>

        {/* AI Analysis */}
        <AnalysisCard matchAnalysisJson={app.matchAnalysis} />

        {/* Raw Claude call artifacts — collapsed by default since it's debug data */}
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
        <div className="card">
          <h3 className="section-title">ציר זמן</h3>
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
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.85rem', color: 'var(--text-dim)' }}>{app.jobDescription}</pre>
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
    <div className="tracker-loading tracker-loading--detail" role="status" aria-live="polite" aria-label="טוען פרטי משרה">
      <div className="skeleton skeleton-back" aria-hidden="true" />

      <div className="tracker-loading__card tracker-loading__card--hero" style={{ '--i': 0 }} aria-hidden="true">
        <div className="tracker-loading__detail-head">
          <div className="tracker-loading__detail-titles">
            <span className="skeleton skeleton-detail-title" />
            <span className="skeleton skeleton-detail-company" />
            <span className="skeleton skeleton-badge" />
          </div>
          <div className="tracker-loading__detail-score">
            <span className="skeleton skeleton-score-big" />
            <span className="skeleton skeleton-verdict-sm" />
          </div>
        </div>
        <div className="tracker-loading__btn-group">
          <span className="skeleton skeleton-btn" />
          <span className="skeleton skeleton-btn" />
          <span className="skeleton skeleton-btn" />
          <span className="skeleton skeleton-btn skeleton-btn--sm" />
        </div>
        <div className="tracker-loading__track">
          <span className="tracker-loading__track-wipe" />
        </div>
      </div>

      <div className="tracker-loading__card" style={{ '--i': 1 }} aria-hidden="true">
        <div className="tracker-loading__section-head">
          <span className="tracker-loading__section-num">A</span>
          <span className="skeleton skeleton-section-title" />
        </div>
        <div className="tracker-loading__analysis-row">
          <span className="skeleton skeleton-flag" />
          <span className="skeleton skeleton-flag skeleton-flag--sm" />
          <span className="skeleton skeleton-flag" />
          <span className="skeleton skeleton-flag skeleton-flag--sm" />
        </div>
        <span className="skeleton skeleton-line skeleton-line--full" />
        <span className="skeleton skeleton-line skeleton-line--long" />
        <span className="skeleton skeleton-line skeleton-line--short" />
      </div>

      <div className="tracker-loading__card" style={{ '--i': 2 }} aria-hidden="true">
        <div className="tracker-loading__section-head">
          <span className="tracker-loading__section-num">§</span>
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
          <span className="tracker-loading__cycle-item">שולף נתוני משרה</span>
          <span className="tracker-loading__cycle-item">קורא ראיונות והערות</span>
          <span className="tracker-loading__cycle-item">מרכיב את הציר</span>
        </span>
        <span className="sr-only">טוען פרטי משרה</span>
      </div>
    </div>
  );
}
