import { useState } from 'react';
import { useUpdateAppStatus, useAddInterview } from '../lib/mutations';
import { STATUS_LABELS } from '../lib/tracker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DateTimePicker } from '@/components/ui/date-time-picker';

// Status is informational, not the row's hero metric — the match score owns
// color (see AnalysisCard's edScoreColor); every pipeline stage renders as
// the same neutral bordered pill so it never competes with the score.
// Accepted is the one terminal-win exception: a solid ink-stamped badge.
const SOLID = new Set(['Accepted']);

// Statuses that represent a scheduled interview stage — picking one of these
// in the status dialog also offers date/time/interviewer fields, so a status
// change and its interview record are captured in one step instead of two.
const STATUS_TO_INTERVIEW_TYPE: Record<string, string> = {
  PhoneScreen: 'Phone',
  TechnicalInterview: 'Technical',
  FinalRound: 'Final',
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const label = STATUS_LABELS[status] || status;
  const base = 'inline-flex items-center rounded-full py-[0.22rem] px-[0.6rem] text-[13px] font-medium uppercase tracking-[0.06em] leading-[1.3] border';

  if (SOLID.has(status)) {
    return (
      <span className={base} style={{ color: 'var(--ed-paper)', background: 'var(--ed-ink)', borderColor: 'var(--ed-ink)' }}>
        {label}
      </span>
    );
  }

  return (
    <span className={`${base} border-[var(--ed-rule)] text-[var(--ed-ink-soft)]`}>
      {label}
    </span>
  );
}

interface StatusModalProps {
  appId: string;
  currentStatus: string;
  onClose: () => void;
  onSaved: () => void;
}

export function StatusModal({ appId, currentStatus, onClose, onSaved }: StatusModalProps) {
  const [status, setStatus] = useState(currentStatus);
  const [note, setNote] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [interviewer, setInterviewer] = useState('');
  const updateStatus = useUpdateAppStatus();
  const addInterview = useAddInterview();

  const interviewType = STATUS_TO_INTERVIEW_TYPE[status];

  function save() {
    updateStatus.mutate(
      { appId, newStatus: status, note: note || undefined },
      {
        onSuccess: () => {
          // ScheduledAt is required server-side — an interviewer name alone
          // isn't enough to create an interview record, so only add one once
          // a date/time is actually set.
          if (interviewType && scheduledAt) {
            addInterview.mutate(
              {
                appId,
                body: {
                  type: interviewType,
                  scheduledAt: new Date(scheduledAt).toISOString(),
                  interviewer: interviewer || null,
                },
              },
              {
                onSuccess: () => onSaved(),
                onError: (e) => alert('Status updated, but saving the interview details failed: ' + e.message),
              },
            );
          } else {
            onSaved();
          }
        },
        onError: (e) => alert('Error: ' + e.message),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Update Status</DialogTitle>
        </DialogHeader>
        <div className="mb-5">
          <Label>New Status</Label>
          <Select value={status} onValueChange={(v: string) => setStatus(v)}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([val, label]) => (
                <SelectItem key={val} value={val}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {interviewType && (
          <>
            <div className="mb-5">
              <Label>Date & Time (optional)</Label>
              <DateTimePicker value={scheduledAt} onChange={setScheduledAt} className="mt-1.5" />
            </div>
            <div className="mb-5">
              <Label>Interviewer (optional)</Label>
              <Input type="text" value={interviewer} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInterviewer(e.target.value)} placeholder="Name" dir="auto" className="mt-1.5" />
            </div>
          </>
        )}
        <div className="mb-5">
          <Label>Note (optional)</Label>
          <Input type="text" value={note} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)} placeholder="Note for the status change" dir="auto" className="mt-1.5" />
        </div>
        <DialogFooter>
          <Button onClick={save}>Update</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
