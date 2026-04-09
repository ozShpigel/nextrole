import { useState } from 'react';
import Modal from '../../components/Modal';
import { api } from '../../utils/api';
import { INTERVIEW_TYPES } from '../../utils/constants';

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
      <h3>{isEdit ? 'ערוך ראיון' : 'הוסף ראיון'}</h3>
      <div className="form-group">
        <label>סוג ראיון</label>
        <select value={form.type} onChange={(e) => update('type', e.target.value)}>
          {INTERVIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>תאריך ושעה</label>
        <input type="datetime-local" value={form.scheduledAt} onChange={(e) => update('scheduledAt', e.target.value)} />
      </div>
      <div className="form-group">
        <label>מראיין/ת</label>
        <input type="text" value={form.interviewer} onChange={(e) => update('interviewer', e.target.value)} placeholder="שם" />
      </div>
      <div className="form-group">
        <label>נושאים</label>
        <input type="text" value={form.topics} onChange={(e) => update('topics', e.target.value)} placeholder="נושאים לראיון" />
      </div>
      {isEdit && (
        <>
          <div className="form-group">
            <label>הערות</label>
            <textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} />
          </div>
          <div className="form-group">
            <label>פידבק</label>
            <textarea value={form.feedback} onChange={(e) => update('feedback', e.target.value)} />
          </div>
          <div className="form-group">
            <label>
              <input type="checkbox" checked={form.completed} onChange={(e) => update('completed', e.target.checked)} />
              {' '}הושלם
            </label>
          </div>
        </>
      )}
      <div className="btn-group">
        <button className="btn btn-primary" onClick={save}>{isEdit ? 'שמור' : 'הוסף'}</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}
