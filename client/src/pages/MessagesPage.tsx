import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMessages } from '../lib/queries';
import { useDeleteMessage } from '../lib/mutations';
import type { MessageItem, MessageUpdateType } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import ConfirmDialog from '../components/ConfirmDialog';
import { relativeTime } from '../lib/format';

const UPDATE_TYPE_LABELS: Record<string, string> = {
  ApplicationReceived: 'Application received',
  InterviewScheduled: 'Interview scheduled',
  Rejected: 'Rejected',
  OfferReceived: 'Offer received',
  FollowUp: 'Follow-up',
};

function updateTypeLabel(updateType: MessageUpdateType): string {
  return UPDATE_TYPE_LABELS[updateType] ?? updateType;
}

function MessageCard({ message, onDelete }: { message: MessageItem; onDelete: (id: string) => void }) {
  const label = updateTypeLabel(message.updateType);
  const card = (
    <div className="group relative border border-[var(--ed-rule)] p-[1.1rem_1.3rem] bg-[var(--ed-panel)] transition-colors hover:border-[var(--ed-ink-faint)]">
      <div className="flex items-start justify-between gap-3 mb-1.5 flex-wrap">
        <div className="min-w-0">
          <p className="text-[16px] font-medium text-[var(--ed-ink)]">
            {message.company}
            {message.jobTitle && <span className="text-[var(--ed-ink-soft)] font-normal"> — {message.jobTitle}</span>}
          </p>
          <p className="text-[13px] text-[var(--ed-ink-soft)] mt-0.5 truncate" dir="auto">{message.subject}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center text-[13px] font-medium uppercase tracking-[0.1em] py-[0.2rem] px-[0.55rem] rounded-full border border-[var(--ed-rule)] text-[var(--ed-ink-soft)]">
            {label}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="opacity-0 group-hover:opacity-100 h-6 px-2 text-[13px] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)]"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(message.id); }}
          >
            Delete
          </Button>
        </div>
      </div>
      <p className="text-[16px] leading-[1.6] text-[var(--ed-ink-faint)] mt-2" dir="auto">{message.snippet}</p>
      <p className="text-[13px] text-[var(--ed-ink-faint)] mt-2.5 pt-2 border-t border-dashed border-[var(--ed-rule)] tabular-nums">
        {relativeTime(message.receivedAt)}
        {!message.applicationId && <span> · not matched to a tracked application</span>}
      </p>
    </div>
  );

  return message.applicationId ? (
    <Link to={`/tracker/${message.applicationId}`} className="block">
      {card}
    </Link>
  ) : card;
}

function MessagesLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-[110px] w-full" />
      <Skeleton className="h-[110px] w-full" />
      <Skeleton className="h-[110px] w-full" />
    </div>
  );
}

export default function MessagesPage() {
  const { data: messages, isLoading, error } = useMessages();
  const deleteMessageMutation = useDeleteMessage();
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function confirmDelete() {
    if (!deleteId) return;
    deleteMessageMutation.mutate(deleteId, {
      onError: (e) => alert('Failed to delete message: ' + e.message),
    });
    setDeleteId(null);
  }

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[800px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
        <header className="mb-9">
          <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[13px] font-medium uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
            <span>Messages</span>
            <span className="hidden sm:block">Synced automatically</span>
          </div>
          <h1 className="font-medium text-[40px] leading-[1.1] tracking-[-0.01em] text-[var(--ed-ink)] pt-4">
            Messages
          </h1>
          <p className="mt-3 max-w-[600px] text-[16px] leading-[1.6] text-[var(--ed-ink-soft)]">
            The email threads behind every status update — the mailbot reads your inbox and drops anything job-related here, whether or not it could tie it to a tracked application.
          </p>
        </header>

        {isLoading ? (
          <MessagesLoadingSkeleton />
        ) : error ? (
          <p className="text-[16px] text-[var(--ed-no)]">Couldn't load messages: {error.message}</p>
        ) : !messages || messages.length === 0 ? (
          <p className="ed-display italic text-[16px] text-[var(--ed-ink-faint)]">
            No messages yet — the mailbot syncs your inbox automatically each day.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageCard key={m.id} message={m} onDelete={setDeleteId} />
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!deleteId}
        description="Delete this message?"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
