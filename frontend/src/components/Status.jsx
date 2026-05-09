import { useState } from 'react';
import { api } from '../utils/api';
import { STATUS_LABELS } from '../constants/tracker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

const STATUS_BADGE_STYLES = {
  Analyzing:            'bg-amber-50 text-amber-600 border-amber-600/12',
  DecidedToApply:       'bg-purple-50 text-purple-500 border-[rgba(139,111,192,0.12)]',
  Applied:              'bg-blue-50 text-blue-500 border-[rgba(74,130,197,0.12)]',
  PhoneScreen:          'bg-emerald-50 text-emerald-600 border-emerald-600/12',
  TechnicalInterview:   'bg-emerald-50 text-emerald-600 border-emerald-600/12',
  FinalRound:           'bg-emerald-50 text-emerald-600 border-emerald-600/12',
  OfferReceived:        'bg-[rgba(45,143,94,0.07)] text-[#2d8f5e] border-emerald-600/12',
  Accepted:             'bg-emerald-50 text-emerald-600 border-emerald-600/15',
  Rejected:             'bg-red-50 text-red-500 border-red-500/12',
  Withdrawn:            'bg-[rgba(120,120,120,0.06)] text-[#888] border-[rgba(120,120,120,0.1)]',
};

export function StatusBadge({ status }) {
  const colorClasses = STATUS_BADGE_STYLES[status] || STATUS_BADGE_STYLES.Analyzing;
  const label = STATUS_LABELS[status] || status;
  return (
    <span className={`inline-block py-1 px-[0.65rem] rounded-sm text-[0.72rem] font-semibold tracking-[0.02em] border ${colorClasses}`}>
      {label}
    </span>
  );
}

export function StatusModal({ appId, currentStatus, onClose, onSaved }) {
  const [status, setStatus] = useState(currentStatus);
  const [note, setNote] = useState('');

  async function save() {
    try {
      await api(`/applications/${appId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ newStatus: status, note: note || null }),
      });
      onSaved();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Status</DialogTitle>
        </DialogHeader>
        <div className="mb-5">
          <Label>New Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v)}>
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
        <div className="mb-5">
          <Label>Note (optional)</Label>
          <Input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the status change" dir="auto" className="mt-1.5" />
        </div>
        <DialogFooter>
          <Button onClick={save}>Update</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
