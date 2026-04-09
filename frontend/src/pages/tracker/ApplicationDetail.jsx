import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { scoreColor } from '../../utils/format';
import StatusBadge from '../../components/StatusBadge';
import CollapsibleSection from '../../components/CollapsibleSection';
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

  if (!data) return <div className="tracker"><div className="container"><p className="empty-state">טוען...</p></div></div>;

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
