import { useState } from 'react';
import { formatDateTime } from '../lib/format';
import { NOTE_CATEGORIES, NOTE_CATEGORY_LABELS } from '../lib/tracker';
import { useDeleteNote, useAddNote } from '../lib/mutations';
import ConfirmDialog from './ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface Note {
  id: string;
  category?: string;
  content: string;
  createdAt: string;
}

interface NoteListProps {
  notes: Note[];
  onRefresh: () => void;
}

export function NoteList({ notes, onRefresh }: NoteListProps) {
  const deleteNoteMutation = useDeleteNote();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function deleteNote(noteId: string) {
    setDeleteId(noteId);
  }

  function confirmDelete() {
    if (!deleteId) return;
    deleteNoteMutation.mutate(deleteId, {
      onSuccess: () => onRefresh(),
      onError: (e) => alert('Failed to delete note: ' + e.message),
    });
    setDeleteId(null);
  }

  if (notes.length === 0) return <p className="text-muted-foreground text-[0.84rem]">No notes</p>;

  return (
    <>
      {notes.map((n) => (
        <div key={n.id} className="bg-muted border border-border rounded p-[1rem_1.25rem] mb-3 transition-all hover:border-border hover:shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="font-semibold text-foreground text-[0.88rem]">{n.category ? (NOTE_CATEGORY_LABELS[n.category] || n.category) : 'Note'}</span>
            <Button variant="destructive" size="sm" onClick={() => deleteNote(n.id)}>Delete</Button>
          </div>
          <div className="text-[0.78rem] text-muted-foreground">{formatDateTime(n.createdAt)}</div>
          <div className="text-[0.84rem] text-foreground leading-[1.6] mt-4 whitespace-pre-wrap">{n.content}</div>
        </div>
      ))}
      <ConfirmDialog
        open={!!deleteId}
        description="Delete this note?"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </>
  );
}

interface NoteModalProps {
  appId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function NoteModal({ appId, onClose, onSaved }: NoteModalProps) {
  const [category, setCategory] = useState('Preparation');
  const [content, setContent] = useState('');
  const addNoteMutation = useAddNote();

  function save() {
    if (!content.trim()) return;
    addNoteMutation.mutate(
      { appId, body: { content: content.trim(), category } },
      {
        onSuccess: () => onSaved(),
        onError: (e) => alert('Error: ' + e.message),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Note</DialogTitle>
        </DialogHeader>
        <div className="mb-5">
          <Label>Category</Label>
          <Select value={category} onValueChange={(v: string) => setCategory(v)}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {NOTE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{NOTE_CATEGORY_LABELS[c] || c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mb-5">
          <Label>Content</Label>
          <Textarea value={content} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)} placeholder="Write a note..." dir="auto" className="mt-1.5 min-h-[120px]" />
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!content.trim()}>Add</Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
