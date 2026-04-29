import { useState } from 'react';
import Modal from '../../components/Modal';
import { api } from '../../utils/api';
import { STATUS_HE } from '../../utils/constants';

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
      <h3 className="mb-5 text-text-bright text-[1.05rem] font-semibold">עדכון סטטוס</h3>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">סטטוס חדש</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow">
          {Object.entries(STATUS_HE).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">הערה (אופציונלי)</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערה לשינוי הסטטוס" className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.6rem] px-6 border-none rounded-lg cursor-pointer text-[0.85rem] font-semibold font-sans transition-all relative overflow-hidden bg-gradient-to-br from-accent to-accent-hover text-white shadow-[0_1px_3px_rgba(168,130,86,0.2)] hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(168,130,86,0.25),var(--shadow-glow)]" onClick={save}>עדכן</button>
        <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.6rem] px-6 border rounded-lg cursor-pointer text-[0.85rem] font-medium font-sans transition-all relative overflow-hidden bg-bg-card text-text-primary border-border-strong hover:border-border-hover hover:shadow-sm" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}
