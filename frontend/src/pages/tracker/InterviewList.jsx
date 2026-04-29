import { formatDateTime } from '../../utils/format';
import { api } from '../../utils/api';
import { Button } from '@/components/ui/button';

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

  if (interviews.length === 0) return <p className="text-muted-foreground text-[0.84rem]">אין ראיונות</p>;

  return interviews.map((i) => (
    <div key={i.id} className="bg-muted border border-border rounded p-[1rem_1.25rem] mb-3 transition-all hover:border-border hover:shadow-sm">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-foreground text-[0.88rem]">ראיון {i.type} {i.completed ? '✅' : ''}</span>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => onEdit(i)}>ערוך</Button>
          <Button variant="destructive" size="sm" onClick={() => deleteInterview(i.id)}>מחק</Button>
        </div>
      </div>
      <div className="text-[0.78rem] text-muted-foreground">{formatDateTime(i.scheduledAt)} {i.interviewer ? `| ${i.interviewer}` : ''}</div>
      {i.topics && <div className="text-[0.84rem] text-foreground leading-[1.6] mt-4">נושאים: {i.topics}</div>}
      {i.notes && <div className="text-[0.84rem] text-foreground leading-[1.6]">הערות: {i.notes}</div>}
      {i.feedback && <div className="text-[0.84rem] text-foreground leading-[1.6]">פידבק: {i.feedback}</div>}
    </div>
  ));
}
