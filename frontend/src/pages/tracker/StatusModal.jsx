import { useState } from 'react';
import Modal from '../../components/Modal';
import { api } from '../../utils/api';
import { STATUS_LABELS } from '../../utils/constants';
import { Button } from '@/components/ui/button';

export default function StatusModal({ appId, currentStatus, onClose, onSaved }) {
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
    <Modal isOpen onClose={onClose}>
      <h3 className="mb-5 text-foreground text-[1.05rem] font-semibold">Update Status</h3>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">New Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20">
          {Object.entries(STATUS_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">Note (optional)</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the status change" dir="auto" className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={save}>Update</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
