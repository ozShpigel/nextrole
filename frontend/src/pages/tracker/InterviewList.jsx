import { formatDateTime } from '../../utils/format';
import { api } from '../../utils/api';

export default function InterviewList({ interviews, onEdit, onRefresh }) {
  async function deleteInterview(intId) {
    if (!confirm('למחוק את הראיון?')) return;
    try {
      await api(`/interviews/${intId}`, { method: 'DELETE' });
      onRefresh();
    } catch (e) {
      alert('מחיקת ראיון נכשלה: ' + e.message);
    }
  }

  if (interviews.length === 0) return <p className="text-text-dim text-[0.84rem]">אין ראיונות</p>;

  return interviews.map((i) => (
    <div key={i.id} className="bg-bg-surface border border-border rounded p-[1rem_1.25rem] mb-3 transition-all hover:border-border-strong hover:shadow-sm">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-text-bright text-[0.88rem]">ראיון {i.type} {i.completed ? '✅' : ''}</span>
        <div className="flex gap-2 flex-wrap">
          <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.35rem] px-[0.85rem] rounded-lg cursor-pointer text-[0.78rem] font-medium font-sans transition-all bg-bg-card text-text-primary border border-border-strong hover:border-border-hover hover:shadow-sm" onClick={() => onEdit(i)}>ערוך</button>
          <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.35rem] px-[0.85rem] rounded-lg cursor-pointer text-[0.78rem] font-medium font-sans transition-all bg-red-bg text-red border border-[rgba(196,84,84,0.12)] hover:bg-[rgba(196,84,84,0.1)] hover:border-[rgba(196,84,84,0.2)]" onClick={() => deleteInterview(i.id)}>מחק</button>
        </div>
      </div>
      <div className="text-[0.78rem] text-text-dim">{formatDateTime(i.scheduledAt)} {i.interviewer ? `| ${i.interviewer}` : ''}</div>
      {i.topics && <div className="text-[0.84rem] text-text-primary leading-[1.6] mt-4">נושאים: {i.topics}</div>}
      {i.notes && <div className="text-[0.84rem] text-text-primary leading-[1.6]">הערות: {i.notes}</div>}
      {i.feedback && <div className="text-[0.84rem] text-text-primary leading-[1.6]">פידבק: {i.feedback}</div>}
    </div>
  ));
}
