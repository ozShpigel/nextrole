import { formatDateTime } from '../../utils/format';
import { NOTE_CATEGORIES_HE } from '../../utils/constants';
import { api } from '../../utils/api';

export default function NoteList({ notes, onRefresh }) {
  async function deleteNote(noteId) {
    if (!confirm('למחוק את ההערה?')) return;
    try {
      await api(`/notes/${noteId}`, { method: 'DELETE' });
      onRefresh();
    } catch (e) {
      alert('מחיקת הערה נכשלה: ' + e.message);
    }
  }

  if (notes.length === 0) return <p className="text-text-dim text-[0.84rem]">אין הערות</p>;

  return notes.map((n) => (
    <div key={n.id} className="bg-bg-surface border border-border rounded p-[1rem_1.25rem] mb-3 transition-all hover:border-border-strong hover:shadow-sm">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-text-bright text-[0.88rem]">{n.category ? (NOTE_CATEGORIES_HE[n.category] || n.category) : 'הערה'}</span>
        <button className="inline-flex items-center justify-center gap-[0.4rem] py-[0.35rem] px-[0.85rem] rounded-lg cursor-pointer text-[0.78rem] font-medium font-sans transition-all bg-red-bg text-red border border-[rgba(196,84,84,0.12)] hover:bg-[rgba(196,84,84,0.1)] hover:border-[rgba(196,84,84,0.2)]" onClick={() => deleteNote(n.id)}>מחק</button>
      </div>
      <div className="text-[0.78rem] text-text-dim">{formatDateTime(n.createdAt)}</div>
      <div className="text-[0.84rem] text-text-primary leading-[1.6] mt-4 whitespace-pre-wrap">{n.content}</div>
    </div>
  ));
}
