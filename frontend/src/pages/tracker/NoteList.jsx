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

  if (notes.length === 0) return <p className="text-dim text-sm">אין הערות</p>;

  return notes.map((n) => (
    <div key={n.id} className="item-card">
      <div className="item-header">
        <span className="item-title">{n.category ? (NOTE_CATEGORIES_HE[n.category] || n.category) : 'הערה'}</span>
        <button className="btn btn-sm btn-danger" onClick={() => deleteNote(n.id)}>מחק</button>
      </div>
      <div className="item-meta">{formatDateTime(n.createdAt)}</div>
      <div className="item-body mt-1" style={{ whiteSpace: 'pre-wrap' }}>{n.content}</div>
    </div>
  ));
}
