import { useState } from 'react';
import Modal from '../../components/Modal';
import { api } from '../../utils/api';
import { NOTE_CATEGORIES, NOTE_CATEGORIES_HE } from '../../utils/constants';

export default function NoteModal({ appId, onClose, onSaved }) {
  const [category, setCategory] = useState('Preparation');
  const [content, setContent] = useState('');

  async function save() {
    try {
      await api(`/applications/${appId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content, category }),
      });
      onSaved();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <Modal isOpen onClose={onClose}>
      <h3>הוסף הערה</h3>
      <div className="form-group">
        <label>קטגוריה</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {NOTE_CATEGORIES.map((c) => <option key={c} value={c}>{NOTE_CATEGORIES_HE[c] || c}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>תוכן</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="כתוב הערה..." />
      </div>
      <div className="btn-group">
        <button className="btn btn-primary" onClick={save}>הוסף</button>
        <button className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}
