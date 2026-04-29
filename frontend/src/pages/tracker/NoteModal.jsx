import { useState } from 'react';
import Modal from '../../components/Modal';
import { api } from '../../utils/api';
import { NOTE_CATEGORIES, NOTE_CATEGORIES_HE } from '../../utils/constants';

export default function NoteModal({ appId, onClose, onSaved }) {
  const [category, setCategory] = useState('Preparation');
  const [content, setContent] = useState('');

  async function save() {
    if (!content.trim()) return;
    try {
      await api(`/applications/${appId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: content.trim(), category }),
      });
      onSaved();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    }
  }

  return (
    <Modal isOpen onClose={onClose}>
      <h3 className="mb-5 text-text-bright text-[1.05rem] font-semibold">הוסף הערה</h3>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">קטגוריה</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow">
          {NOTE_CATEGORIES.map((c) => <option key={c} value={c}>{NOTE_CATEGORIES_HE[c] || c}</option>)}
        </select>
      </div>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-text-dim mb-[0.4rem] font-medium uppercase tracking-[0.04em]">תוכן</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="כתוב הערה..." className="w-full py-[0.65rem] px-[0.9rem] bg-bg-input border border-border rounded-lg text-text-primary font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent-glow min-h-[120px] resize-y leading-[1.7]" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.6rem] px-6 border-none rounded-lg cursor-pointer text-[0.85rem] font-semibold font-sans transition-all relative overflow-hidden bg-gradient-to-br from-accent to-accent-hover text-white shadow-[0_1px_3px_rgba(168,130,86,0.2)] hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(168,130,86,0.25),var(--shadow-glow)] disabled:opacity-35 disabled:cursor-not-allowed" onClick={save} disabled={!content.trim()}>הוסף</button>
        <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.6rem] px-6 border rounded-lg cursor-pointer text-[0.85rem] font-medium font-sans transition-all relative overflow-hidden bg-bg-card text-text-primary border-border-strong hover:border-border-hover hover:shadow-sm" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  );
}
