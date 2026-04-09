import { formatDateTime } from '../../utils/format';
import { api } from '../../utils/api';

export default function InterviewList({ interviews, onEdit, onRefresh }) {
  async function deleteInterview(intId) {
    if (!confirm('למחוק את הראיון?')) return;
    await api(`/interviews/${intId}`, { method: 'DELETE' });
    onRefresh();
  }

  if (interviews.length === 0) return <p className="text-dim text-sm">אין ראיונות</p>;

  return interviews.map((i) => (
    <div key={i.id} className="item-card">
      <div className="item-header">
        <span className="item-title">ראיון {i.type} {i.completed ? '\u2705' : ''}</span>
        <div className="btn-group">
          <button className="btn btn-sm btn-secondary" onClick={() => onEdit(i)}>ערוך</button>
          <button className="btn btn-sm btn-danger" onClick={() => deleteInterview(i.id)}>מחק</button>
        </div>
      </div>
      <div className="item-meta">{formatDateTime(i.scheduledAt)} {i.interviewer ? `| ${i.interviewer}` : ''}</div>
      {i.topics && <div className="item-body mt-1">נושאים: {i.topics}</div>}
      {i.notes && <div className="item-body">הערות: {i.notes}</div>}
      {i.feedback && <div className="item-body">פידבק: {i.feedback}</div>}
    </div>
  ));
}
