import { MessageSquare } from 'lucide-react';

export default function MessagesPage() {
  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] flex items-center justify-center text-center px-6 animate-in fade-in slide-in-from-bottom-1 duration-500">
      <div className="max-w-[420px]">
        <MessageSquare size={28} className="mx-auto mb-5 text-[var(--ed-ink-faint)]" aria-hidden="true" />
        <h1 className="ed-display font-black text-[clamp(1.8rem,4vw,2.6rem)] leading-[0.95] tracking-[-0.02em] text-[var(--ed-ink)] mb-3">
          Messages
        </h1>
        <p className="text-[0.92rem] leading-[1.6] text-[var(--ed-ink-soft)]">
          Coming soon — a home for the email threads behind every status update.
        </p>
      </div>
    </div>
  );
}
