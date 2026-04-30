import { useState } from 'react';
import { api } from '../../utils/api';
import { STATUS_LABELS } from '../../utils/constants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
      alert('Error saving: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6 mb-4">
      <h3 className="text-[0.95rem] font-semibold text-foreground mb-3 pb-[0.6rem] border-b border-border">Add New Application</h3>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
          <div className="mb-5">
            <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">Job Title *</label>
            <input type="text" required placeholder="Senior Backend Engineer" value={form.jobTitle} onChange={(e) => update('jobTitle', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20" />
          </div>
          <div className="mb-5">
            <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">Company *</label>
            <input type="text" required placeholder="Company name" value={form.company} onChange={(e) => update('company', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20" />
          </div>
        </div>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
          <div className="mb-5">
            <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">Status</label>
            <select value={form.status} onChange={(e) => update('status', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20">
              {Object.entries(STATUS_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
          <div className="mb-5">
            <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">Match Score</label>
            <input type="number" min="0" max="100" placeholder="0-100" value={form.matchScore} onChange={(e) => update('matchScore', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20" />
          </div>
        </div>
        <div className="mb-5">
          <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">Verdict</label>
          <input type="text" placeholder="STRONG_YES / YES / MAYBE / NO" value={form.matchVerdict} onChange={(e) => update('matchVerdict', e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20" />
        </div>
        <div className="mb-5">
          <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">Job Description</label>
          <textarea placeholder="Paste the job description here..." value={form.jobDescription} onChange={(e) => update('jobDescription', e.target.value)} dir="auto" className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 min-h-[120px] resize-y leading-[1.7]" />
        </div>
        <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Application'}</Button>
      </form>
    </Card>
  );
}
