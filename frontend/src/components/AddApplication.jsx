import { useState } from 'react';
import { api } from '../utils/api';
import { STATUS_LABELS } from '../utils/constants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

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
            <Label>Job Title *</Label>
            <Input type="text" required placeholder="Senior Backend Engineer" value={form.jobTitle} onChange={(e) => update('jobTitle', e.target.value)} />
          </div>
          <div className="mb-5">
            <Label>Company *</Label>
            <Input type="text" required placeholder="Company name" value={form.company} onChange={(e) => update('company', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
          <div className="mb-5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => update('status', v)}>
              <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="mb-5">
            <Label>Match Score</Label>
            <Input type="number" min="0" max="100" placeholder="0-100" value={form.matchScore} onChange={(e) => update('matchScore', e.target.value)} />
          </div>
        </div>
        <div className="mb-5">
          <Label>Verdict</Label>
          <Input type="text" placeholder="STRONG_YES / YES / MAYBE / NO" value={form.matchVerdict} onChange={(e) => update('matchVerdict', e.target.value)} />
        </div>
        <div className="mb-5">
          <Label>Job Description</Label>
          <Textarea placeholder="Paste the job description here..." value={form.jobDescription} onChange={(e) => update('jobDescription', e.target.value)} dir="auto" />
        </div>
        <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Application'}</Button>
      </form>
    </Card>
  );
}
