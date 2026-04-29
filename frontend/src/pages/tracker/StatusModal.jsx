import { useState } from 'react';
import Modal from '../../components/Modal';
import { api } from '../../utils/api';
import { STATUS_HE } from '../../utils/constants';
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
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <Modal isOpen onClose={onClose}>
      <h3 className="mb-5 text-foreground text-[1.05rem] font-semibold">עדכון סטטוס</h3>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">סטטוס חדש</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20">
          {Object.entries(STATUS_HE).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">הערה (אופציונלי)</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערה לשינוי הסטטוס" className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={save}>עדכן</Button>
        <Button variant="outline" onClick={onClose}>ביטול</Button>
      </div>
    </Modal>
  );
}
