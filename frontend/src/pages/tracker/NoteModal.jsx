import { useState } from 'react';
import Modal from '../../components/Modal';
import { api } from '../../utils/api';
import { NOTE_CATEGORIES, NOTE_CATEGORIES_HE } from '../../utils/constants';
import { Button } from '@/components/ui/button';

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
      <h3 className="mb-5 text-foreground text-[1.05rem] font-semibold">הוסף הערה</h3>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">קטגוריה</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20">
          {NOTE_CATEGORIES.map((c) => <option key={c} value={c}>{NOTE_CATEGORIES_HE[c] || c}</option>)}
        </select>
      </div>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">תוכן</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="כתוב הערה..." className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] rtl transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 min-h-[120px] resize-y leading-[1.7]" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={save} disabled={!content.trim()}>הוסף</Button>
        <Button variant="outline" onClick={onClose}>ביטול</Button>
      </div>
    </Modal>
  );
}
