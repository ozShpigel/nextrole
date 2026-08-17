import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] flex items-center justify-center animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="relative z-[1] text-center px-6">
        <span className="ed-display text-[6rem] font-bold text-[var(--ed-ink-faint)]/30 leading-none tracking-[-0.04em]">404</span>
        <h1 className="ed-display text-[1.6rem] font-bold text-[var(--ed-ink)] mt-2 mb-2 tracking-[-0.01em]">Page not found</h1>
        <p className="text-[var(--ed-ink-faint)] text-[0.92rem] mb-6 max-w-[360px] mx-auto leading-[1.6]">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/"
          className="rounded-full border border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] px-4 py-[0.55rem] text-[0.7rem] font-semibold uppercase tracking-[0.1em] transition-all hover:bg-[var(--ed-accent-deep)] inline-block"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
