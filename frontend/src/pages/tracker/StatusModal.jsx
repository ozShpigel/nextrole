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
      <h3>עדכון סטטוס</h3>
      <div className="form-group">
        <label>סטטוס חדש</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(STATUS_HE).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>הערה (אופציונלי)</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערה לשינוי הסטטוס" />
      </div>
      <div className="btn-group">
        <button className="btn btn-primary" onClick={save}>עדכן</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}
