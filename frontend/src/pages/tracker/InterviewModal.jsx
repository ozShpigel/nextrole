import { useState } from 'react';
import Modal from '../../components/Modal';
import { api } from '../../utils/api';
import { INTERVIEW_TYPES } from '../../utils/constants';
import { Button } from '@/components/ui/button';

export default function InterviewModal({ appId, interview, onClose, onSaved }) {
  const isEdit = !!interview;
  const [form, setForm] = useState({
    type: interview?.type || 'Phone',
    scheduledAt: interview?.scheduledAt ? new Date(interview.scheduledAt).toISOString().slice(0, 16) : '',
    interviewer: interview?.interviewer || '',
    topics: interview?.topics || '',
    notes: interview?.notes || '',
    feedback: interview?.feedback || '',
    completed: interview?.completed || false,
  });

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function save() {
    try {
      const body = {
        type: form.type,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
        interviewer: form.interviewer || null,
        topics: form.topics || null,
        notes: form.notes || null,
        feedback: form.feedback || null,
        completed: form.completed,
      };

      if (isEdit) {
        await api(`/interviews/${interview.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api(`/applications/${appId}/interviews`, { method: 'POST', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <Modal isOpen onClose={onClose}>
      <h3 className="mb-5 text-foreground text-[1.05rem] font-semibold">{isEdit ? 'ערוך ראיון' : 'הוסף ראיון'}</h3>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">סוג ראיון</label>
        <select value={form.type} onChange={(e) => update('type', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20">
          {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">תאריך ושעה</label>
        <input type="datetime-local" value={form.scheduledAt} onChange={(e) => update('scheduledAt', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20" />
      </div>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">מראיין/ת</label>
        <input type="text" value={form.interviewer} onChange={(e) => update('interviewer', e.target.value)} placeholder="שם" className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20" />
      </div>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">נושאים</label>
        <input type="text" value={form.topics} onChange={(e) => update('topics', e.target.value)} placeholder="נושאים לראיון" className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20" />
      </div>
      {isEdit && (
        <>
          <div className="mb-5">
            <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">הערות</label>
            <textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 min-h-[120px] resize-y leading-[1.7]" />
          </div>
          <div className="mb-5">
            <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">פידבק</label>
            <textarea value={form.feedback} onChange={(e) => update('feedback', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 min-h-[120px] resize-y leading-[1.7]" />
          </div>
          <div className="mb-5">
            <label className="flex items-center gap-2 text-[0.8rem] text-muted-foreground font-medium">
              <input type="checkbox" checked={form.completed} onChange={(e) => update('completed', e.target.checked)} />
              הושלם
            </label>
          </div>
        </>
      )}
      <div className="flex gap-2 flex-wrap">
        <Button onClick={save}>{isEdit ? 'שמור' : 'הוסף'}</Button>
        <Button variant="outline" onClick={onClose}>ביטול</Button>
      </div>
    </Modal>
  );
}
