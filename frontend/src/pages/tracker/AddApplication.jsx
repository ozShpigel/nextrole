import { useState } from 'react';
import { api } from '../../utils/api';
import { STATUS_HE } from '../../utils/constants';

export default function AddApplication({ onSaved }) {
  const [form, setForm] = useState({
    jobTitle: '', company: '', status: 'Analyzing', matchScore: '', matchVerdict: '', jobDescription: '',
  });
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/applications', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          matchScore: form.matchScore ? parseInt(form.matchScore) : null,
          matchVerdict: form.matchVerdict || null,
          jobDescription: form.jobDescription || null,
        }),
      });
      onSaved();
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h3 className="section-title">הוסף משרה חדשה</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>שם התפקיד *</label>
            <input type="text" required placeholder="Senior Backend Engineer" value={form.jobTitle} onChange={(e) => update('jobTitle', e.target.value)} />
          </div>
          <div className="form-group">
            <label>חברה *</label>
            <input type="text" required placeholder="שם החברה" value={form.company} onChange={(e) => update('company', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>סטטוס</label>
            <select value={form.status} onChange={(e) => update('status', e.target.value)}>
              {Object.entries(STATUS_HE).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>ציון התאמה</label>
            <input type="number" min="0" max="100" placeholder="0-100" value={form.matchScore} onChange={(e) => update('matchScore', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>וורדיקט</label>
          <input type="text" placeholder="STRONG_YES / YES / MAYBE / NO" value={form.matchVerdict} onChange={(e) => update('matchVerdict', e.target.value)} />
        </div>
        <div className="form-group">
          <label>תיאור המשרה</label>
          <textarea placeholder="הדבק את תיאור המשרה כאן..." value={form.jobDescription} onChange={(e) => update('jobDescription', e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'שומר...' : 'הוסף משרה'}</button>
      </form>
    </div>
  );
}
