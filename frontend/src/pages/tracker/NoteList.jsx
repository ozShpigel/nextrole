import { formatDateTime } from '../../utils/format';
import { NOTE_CATEGORIES_HE } from '../../utils/constants';
import { api } from '../../utils/api';
import { Button } from '@/components/ui/button';

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

  if (notes.length === 0) return <p className="text-muted-foreground text-[0.84rem]">אין הערות</p>;

  return notes.map((n) => (
    <div key={n.id} className="bg-muted border border-border rounded p-[1rem_1.25rem] mb-3 transition-all hover:border-border hover:shadow-sm">
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-foreground text-[0.88rem]">{n.category ? (NOTE_CATEGORIES_HE[n.category] || n.category) : 'הערה'}</span>
        <Button variant="destructive" size="sm" onClick={() => deleteNote(n.id)}>מחק</Button>
      </div>
      <div className="text-[0.78rem] text-muted-foreground">{formatDateTime(n.createdAt)}</div>
      <div className="text-[0.84rem] text-foreground leading-[1.6] mt-4 whitespace-pre-wrap">{n.content}</div>
    </div>
  ));
}
