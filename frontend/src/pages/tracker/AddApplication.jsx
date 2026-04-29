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
    <div className="bg-bg-card border border-border rounded-lg p-6 mb-4 shadow-sm transition-all hover:border-border-strong hover:shadow-md">
      <h3 className="text-[0.95rem] font-semibold text-text-bright mb-3 pb-[0.6rem] border-b border-border">הוסף משרה חדשה</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
          <div className="mb-5">
            <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">שם התפקיד *</label>
            <input type="text" required placeholder="Senior Backend Engineer" value={form.jobTitle} onChange={(e) => update('jobTitle', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow" />
          </div>
          <div className="mb-5">
            <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">חברה *</label>
            <input type="text" required placeholder="שם החברה" value={form.company} onChange={(e) => update('company', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow" />
          </div>
        </div>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
          <div className="mb-5">
            <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">סטטוס</label>
            <select value={form.status} onChange={(e) => update('status', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow">
              {Object.entries(STATUS_HE).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
          <div className="mb-5">
            <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">ציון התאמה</label>
            <input type="number" min="0" max="100" placeholder="0-100" value={form.matchScore} onChange={(e) => update('matchScore', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow" />
          </div>
        </div>
        <div className="mb-5">
          <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">וורדיקט</label>
          <input type="text" placeholder="STRONG_YES / YES / MAYBE / NO" value={form.matchVerdict} onChange={(e) => update('matchVerdict', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow" />
        </div>
        <div className="mb-5">
          <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">תיאור המשרה</label>
          <textarea placeholder="הדבק את תיאור המשרה כאן..." value={form.jobDescription} onChange={(e) => update('jobDescription', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow min-h-[120px] resize-y leading-[1.7]" />
        </div>
        <button type="submit" className="inline-flex items-center justify-center gap-[0.4rem] py-[0.6rem] px-6 border-none rounded-lg cursor-pointer text-[0.85rem] font-semibold font-sans transition-all relative overflow-hidden bg-gradient-to-br from-accent to-accent-hover text-white shadow-[0_1px_3px_rgba(168,130,86,0.2)] hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(168,130,86,0.25),var(--shadow-glow)] disabled:opacity-35 disabled:cursor-not-allowed" disabled={saving}>{saving ? 'שומר...' : 'הוסף משרה'}</button>
      </form>
    </div>
  );
}
