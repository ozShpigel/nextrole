import { useEffect, useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { useMessages } from '../lib/queries';
import { useDeleteMessage, useMarkMessageRead } from '../lib/mutations';
import type { MessageItem, MessageUpdateType } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
import { Input } from '../components/ui/input';
import ConfirmDialog from '../components/ConfirmDialog';
import { CompanyAvatar } from '../components/CompanyAvatar';
import { relativeTime, formatDateTime } from '../lib/format';

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

// The raw email subject is almost always just "{title} at {company}" or a
// close variant of it — already fully covered by the row/header showing
// company+title directly, so showing it again was pure duplication. Only
// surface it when it actually carries something that isn't already shown
// (e.g. "You've been shortlisted!").
function isRedundantSubject(subject: string, company: string, jobTitle: string | null | undefined): boolean {
  const s = subject.toLowerCase();
  const hasCompany = company.length > 0 && s.includes(company.toLowerCase());
  const hasTitle = !jobTitle || s.includes(jobTitle.toLowerCase());
  return hasCompany && hasTitle;
}

// Mailbot's stored snippet is the first 400 raw chars of the email body,
// whitespace-collapsed but otherwise unprocessed — for a LinkedIn job-alert
// digest that means a full tracking URL (?trackingId=...&refId=...&lipi=...)
// sitting in the middle of the visible text. Strip URLs at display time
// since already-stored snippets can't be retroactively cleaned without a
// mailbot resync (new messages get a clean snippet from the source already).
function cleanSnippet(snippet: string): string {
  return snippet.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
}

function MessageRow({ message, selected, onSelect }: { message: MessageItem; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center gap-3 text-left border rounded-xl px-3.5 py-3 transition-colors ${
        selected ? 'border-[var(--ed-rule)] bg-[var(--ed-accent)]/10' : 'border-[var(--ed-rule)] hover:border-[var(--ed-ink-faint)]'
      }`}
    >
      <div className="relative shrink-0">
        <CompanyAvatar name={message.company} logo={message.companyLogo} size={32} />
        {!message.isRead && (
          <span
            className="absolute -top-0.5 -right-0.5 w-[9px] h-[9px] rounded-full bg-[var(--ed-accent)] border-2 border-[var(--ed-paper)]"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`min-w-0 text-[14px] truncate ${selected ? 'font-medium text-[var(--ed-accent)]' : message.isRead ? 'font-normal text-[var(--ed-ink-soft)]' : 'font-medium text-[var(--ed-ink)]'}`}>
            {message.company}
            {message.jobTitle && <span className="text-[var(--ed-ink-faint)] font-normal"> · {message.jobTitle}</span>}
          </p>
          <span className="shrink-0 text-[12px] text-[var(--ed-ink-faint)] tabular-nums">{relativeTime(message.receivedAt)}</span>
        </div>
        {!message.applicationId && (
          <span className="inline-flex items-center gap-[0.3rem] text-[12px] text-[var(--ed-ink-faint)] mt-0.5">
            <span className="shrink-0 w-[5px] h-[5px] rounded-full bg-[var(--ed-gold)]" aria-hidden="true" />
            Not tracked
          </span>
        )}
      </div>
    </button>
  );
}

function MessageDetail({ message, onDelete }: { message: MessageItem; onDelete: (id: string) => void }) {
  const showSubject = !isRedundantSubject(message.subject, message.company, message.jobTitle);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-[var(--ed-rule)] shrink-0">
        <span className="inline-flex items-center text-[13px] font-medium uppercase tracking-[0.1em] py-[0.2rem] px-[0.55rem] rounded-full border border-[var(--ed-rule)] text-[var(--ed-ink-soft)]">
          {updateTypeLabel(message.updateType)}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-[0.35rem] text-[13px] text-[var(--ed-ink-faint)] hover:text-[var(--ed-no)] transition-colors"
          onClick={() => onDelete(message.id)}
        >
          <Trash2 size={13} aria-hidden="true" /> Delete
        </button>
      </div>

      <div className="flex-1 overflow-y-auto ed-scroll p-6">
        <h2 className="text-[22px] font-medium leading-[1.3] text-[var(--ed-ink)]">
          {message.company}
          {message.jobTitle && <span className="text-[var(--ed-ink-soft)]"> — {message.jobTitle}</span>}
        </h2>
        {showSubject && (
          <p className="text-[14px] text-[var(--ed-ink-soft)] mt-1" dir="auto">{message.subject}</p>
        )}
        <div className="flex items-center gap-x-2 flex-wrap text-[13px] text-[var(--ed-ink-faint)] mt-2 tabular-nums">
          <span>{message.from}</span>
          <span>·</span>
          <span>{formatDateTime(message.receivedAt)}</span>
        </div>

        <p className="text-[16px] leading-[1.7] text-[var(--ed-ink-soft)] mt-6 pt-6 border-t border-[var(--ed-rule)] whitespace-pre-wrap" dir="auto">
          {cleanSnippet(message.snippet)}
        </p>
      </div>
    </div>
  );
}

function MessagesLoadingSkeleton() {
  return (
    <div className="flex gap-5 items-start max-[900px]:flex-col">
      <div className="w-[340px] shrink-0 flex flex-col gap-2 max-[900px]:w-full">
        <Skeleton className="h-11 w-full mb-2" />
        <Skeleton className="h-[64px] w-full" />
        <Skeleton className="h-[64px] w-full" />
        <Skeleton className="h-[64px] w-full" />
      </div>
      <Skeleton className="flex-1 min-w-0 h-[420px]" />
    </div>
  );
}

export default function MessagesPage() {
  const { data: messages, isLoading, error } = useMessages();
  const deleteMessageMutation = useDeleteMessage();
  const markReadMutation = useMarkMessageRead();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!messages) return [];
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => m.company.toLowerCase().includes(q) || (m.jobTitle ?? '').toLowerCase().includes(q));
  }, [messages, search]);

  const selected = filtered.find((m) => m.id === selectedId) ?? filtered[0] ?? null;
  const unreadCount = useMemo(() => messages?.filter((m) => !m.isRead).length ?? 0, [messages]);

  useEffect(() => {
    if (selected && !selected.isRead) {
      markReadMutation.mutate(selected.id);
    }
    // Only re-run when the viewed message (or its read state) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.isRead]);

  function confirmDelete() {
    if (!deleteId) return;
    deleteMessageMutation.mutate(deleteId, {
      onError: (e) => alert('Failed to delete message: ' + e.message),
    });
    setDeleteId(null);
  }

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1400px] mx-auto px-5 pt-12 pb-16 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-4 max-[640px]:pt-8">
        <header className="mb-9 pb-4 border-b border-[var(--ed-rule)] flex items-center justify-between gap-4">
          <h1 className="font-medium text-[40px] leading-[1.1] tracking-[-0.01em] text-[var(--ed-ink)]">
            Messages
          </h1>
          {!isLoading && !error && messages && messages.length > 0 && (
            unreadCount > 0 ? (
              <span className="inline-flex items-center text-[12px] font-medium uppercase tracking-[0.08em] px-3 py-1.5 rounded-full border border-[var(--ed-rule)] bg-[var(--ed-panel)] text-[var(--ed-ink-faint)] tabular-nums">
                {unreadCount} unread
              </span>
            ) : (
              <p className="text-[13px] text-[var(--ed-ink-faint)] tabular-nums">
                {messages.length} message{messages.length === 1 ? '' : 's'}
              </p>
            )
          )}
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
          <div className="flex gap-5 items-start max-[900px]:flex-col">
            <div className="w-[340px] shrink-0 flex flex-col gap-2 max-[900px]:w-full">
              <div className="relative mb-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ed-ink-faint)]" aria-hidden="true" />
                <Input
                  placeholder="Search company or role"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-11 rounded-full border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)] pl-10"
                />
              </div>
              {filtered.length === 0 ? (
                <p className="text-[13px] text-[var(--ed-ink-faint)] px-1 py-3">No messages match "{search}".</p>
              ) : (
                filtered.map((m) => (
                  <MessageRow key={m.id} message={m} selected={selected?.id === m.id} onSelect={() => setSelectedId(m.id)} />
                ))
              )}
            </div>

            {selected && (
              <section
                className="flex-1 min-w-0 border border-[var(--ed-rule)] rounded-2xl overflow-hidden flex flex-col
                           sticky top-14 max-h-[calc(100vh-3.5rem-2rem)]
                           max-[900px]:static max-[900px]:max-h-none max-[900px]:mt-5 max-[900px]:w-full"
              >
                <MessageDetail message={selected} onDelete={setDeleteId} />
              </section>
            )}
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
