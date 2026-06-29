import { useState } from 'react';
import { formatDateTime, formatTime } from '../lib/format';
import { useDeleteInterview, useAddInterview, useUpdateInterview } from '../lib/mutations';
import { INTERVIEW_TYPES } from '../lib/tracker';
import ConfirmDialog from './ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface Interview {
  id: string;
  type: string;
  scheduledAt: string;
  endsAt?: string | null;
  interviewer?: string;
  topics?: string;
  notes?: string;
  feedback?: string;
  completed: boolean;
}

interface InterviewListProps {
  interviews: Interview[];
  onEdit: (interview: Interview) => void;
  onRefresh: () => void;
}

export function InterviewList({ interviews, onEdit, onRefresh }: InterviewListProps) {
  const deleteInterviewMutation = useDeleteInterview();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function deleteInterview(intId: string) {
    setDeleteId(intId);
  }

  function confirmDelete() {
    if (!deleteId) return;
    deleteInterviewMutation.mutate(deleteId, {
      onSuccess: () => onRefresh(),
      onError: (e) => alert('Failed to delete interview: ' + e.message),
    });
    setDeleteId(null);
  }

  if (interviews.length === 0) return <p className="text-muted-foreground text-[0.84rem]">No interviews</p>;

  return (
    <>
      {interviews.map((i) => (
        <div key={i.id} className="bg-muted border border-border rounded p-[1rem_1.25rem] mb-3 transition-all hover:border-border hover:shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="font-semibold text-foreground text-[0.88rem]">Interview: {i.type} {i.completed ? '✅' : ''}</span>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => onEdit(i)}>Edit</Button>
              <Button variant="destructive" size="sm" onClick={() => deleteInterview(i.id)}>Delete</Button>
            </div>
          </div>
          <div className="text-[0.78rem] text-muted-foreground">{formatDateTime(i.scheduledAt)}{i.endsAt ? `–${formatTime(i.endsAt)}` : ''} {i.interviewer ? `| ${i.interviewer}` : ''}</div>
          {i.topics && <div className="text-[0.84rem] text-foreground leading-[1.6] mt-4">Topics: {i.topics}</div>}
          {i.notes && <div className="text-[0.84rem] text-foreground leading-[1.6]">Notes: {i.notes}</div>}
          {i.feedback && <div className="text-[0.84rem] text-foreground leading-[1.6]">Feedback: {i.feedback}</div>}
        </div>
      ))}
      <ConfirmDialog
        open={!!deleteId}
        description="Delete this interview?"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </>
  );
}

interface InterviewModalProps {
  appId: string;
  interview?: Interview | null;
  onClose: () => void;
  onSaved: () => void;
}

interface InterviewFormState {
  type: string;
  scheduledAt: string;
  interviewer: string;
  topics: string;
  notes: string;
  feedback: string;
  completed: boolean;
}

export function InterviewModal({ appId, interview, onClose, onSaved }: InterviewModalProps) {
  const isEdit = !!interview;
  const [form, setForm] = useState<InterviewFormState>({
    type: interview?.type || 'Phone',
    scheduledAt: interview?.scheduledAt ? new Date(interview.scheduledAt).toISOString().slice(0, 16) : '',
    interviewer: interview?.interviewer || '',
    topics: interview?.topics || '',
    notes: interview?.notes || '',
    feedback: interview?.feedback || '',
    completed: interview?.completed || false,
  });
  const addInterviewMutation = useAddInterview();
  const updateInterviewMutation = useUpdateInterview();

  function update(field: keyof InterviewFormState, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function save() {
    const body = {
      type: form.type,
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      interviewer: form.interviewer || null,
      topics: form.topics || null,
      notes: form.notes || null,
      feedback: form.feedback || null,
      completed: form.completed,
    };

    const callbacks = {
      onSuccess: () => onSaved(),
      onError: (e: Error) => alert('Error: ' + e.message),
    };

    if (isEdit) {
      updateInterviewMutation.mutate({ interviewId: interview!.id, body }, callbacks);
    } else {
      addInterviewMutation.mutate({ appId, body }, callbacks);
    }
  }

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Interview' : 'Add Interview'}</DialogTitle>
        </DialogHeader>
        <div className="mb-5">
          <Label>Interview Type</Label>
          <Select value={form.type} onValueChange={(v: string) => update('type', v)}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {INTERVIEW_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mb-5">
          <Label>Date & Time</Label>
          <Input type="datetime-local" value={form.scheduledAt} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('scheduledAt', e.target.value)} className="mt-1.5" />
        </div>
        <div className="mb-5">
          <Label>Interviewer</Label>
          <Input type="text" value={form.interviewer} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('interviewer', e.target.value)} placeholder="Name" className="mt-1.5" />
        </div>
        <div className="mb-5">
          <Label>Topics</Label>
          <Input type="text" value={form.topics} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('topics', e.target.value)} placeholder="Interview topics" className="mt-1.5" />
        </div>
        {isEdit && (
          <>
            <div className="mb-5">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => update('notes', e.target.value)} dir="auto" className="mt-1.5 min-h-[120px]" />
            </div>
            <div className="mb-5">
              <Label>Feedback</Label>
              <Textarea value={form.feedback} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => update('feedback', e.target.value)} dir="auto" className="mt-1.5 min-h-[120px]" />
            </div>
            <div className="mb-5">
              <label className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                <input type="checkbox" checked={form.completed} onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('completed', e.target.checked)} />
                Completed
              </label>
            </div>
          </>
        )}
        <DialogFooter>
          <Button onClick={save}>{isEdit ? 'Save' : 'Add'}</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
