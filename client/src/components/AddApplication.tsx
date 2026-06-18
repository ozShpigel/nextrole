import { useState } from 'react';
import { useAddApplication } from '../lib/mutations';
import { STATUS_LABELS } from '../lib/tracker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface AddApplicationProps {
  onSaved: () => void;
}

interface FormState {
  jobTitle: string;
  company: string;
  status: string;
  matchScore: string;
  matchVerdict: string;
  jobDescription: string;
}

export default function AddApplication({ onSaved }: AddApplicationProps) {
  const [form, setForm] = useState<FormState>({
    jobTitle: '', company: '', status: 'Analyzing', matchScore: '', matchVerdict: '', jobDescription: '',
  });
  const addMutation = useAddApplication();

  function update(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    addMutation.mutate(
      {
        ...form,
        matchScore: form.matchScore ? parseInt(form.matchScore) : null,
        matchVerdict: form.matchVerdict || null,
        jobDescription: form.jobDescription || null,
      },
      {
        onSuccess: () => onSaved(),
        onError: (err: Error) => alert('Error saving: ' + err.message),
      },
    );
  }

  return (
    <section className="mb-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="ed-display italic font-semibold text-[1.4rem] tracking-[-0.01em] text-[var(--ed-ink)]">Add New Application</span>
      </div>
      <div className="border-t border-[var(--ed-rule-strong)] mb-6" />
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
          <div className="mb-5">
            <Label>Job Title *</Label>
            <Input type="text" required placeholder="Senior Backend Engineer" value={form.jobTitle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('jobTitle', e.target.value)} />
          </div>
          <div className="mb-5">
            <Label>Company *</Label>
            <Input type="text" required placeholder="Company name" value={form.company} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('company', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-4">
          <div className="mb-5">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v: string) => update('status', v)}>
              <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="mb-5">
            <Label>Match Score</Label>
            <Input type="number" min="0" max="100" placeholder="0-100" value={form.matchScore} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('matchScore', e.target.value)} />
          </div>
        </div>
        <div className="mb-5">
          <Label>Verdict</Label>
          <Input type="text" placeholder="STRONG_YES / YES / MAYBE / NO" value={form.matchVerdict} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('matchVerdict', e.target.value)} />
        </div>
        <div className="mb-5">
          <Label>Job Description</Label>
          <Textarea placeholder="Paste the job description here..." value={form.jobDescription} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => update('jobDescription', e.target.value)} dir="auto" />
        </div>
        <button type="submit" disabled={addMutation.isPending} className="rounded-none border border-[var(--ed-accent)] bg-[var(--ed-accent)] px-4 py-[0.55rem] text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-paper)] transition-all hover:bg-[var(--ed-accent-deep)] disabled:opacity-50">{addMutation.isPending ? 'Saving...' : 'Add Application'}</button>
      </form>
    </section>
  );
}
