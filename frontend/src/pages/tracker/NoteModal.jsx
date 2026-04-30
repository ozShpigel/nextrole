import { useState } from 'react';
import Modal from '../../components/Modal';
import { api } from '../../utils/api';
import { NOTE_CATEGORIES, NOTE_CATEGORY_LABELS } from '../../utils/constants';
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
      alert('Error: ' + e.message);
    }
  }

  return (
    <Modal isOpen onClose={onClose}>
      <h3 className="mb-5 text-foreground text-[1.05rem] font-semibold">Add Note</h3>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20">
          {NOTE_CATEGORIES.map((c) => <option key={c} value={c}>{NOTE_CATEGORY_LABELS[c] || c}</option>)}
        </select>
      </div>
      <div className="mb-5">
        <label className="block text-[0.8rem] text-muted-foreground mb-[0.4rem] font-medium uppercase tracking-[0.04em]">Content</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write a note..." dir="auto" className="w-full py-[0.65rem] px-[0.9rem] bg-background border border-border rounded-lg text-foreground font-sans text-[0.88rem] transition-all focus:outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/20 min-h-[120px] resize-y leading-[1.7]" />
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button onClick={save} disabled={!content.trim()}>Add</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}
