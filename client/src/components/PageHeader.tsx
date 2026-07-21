import { Button } from '@/components/ui/button';
import { useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';

interface PageHeaderProps {
  onNewCriteria: () => void;
}

const TODAY = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

export default function PageHeader({ onNewCriteria }: PageHeaderProps) {
  const demoMode = useDemoMode();
  return (
    <header className="relative mb-9 pt-2">
      {/* dateline / running head */}
      <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
        <span>Discovery</span>
        <span className="text-[var(--ed-accent)] hidden sm:block">Collect · runs automatically</span>
        <span className="tabular-nums">{TODAY}</span>
      </div>

      {/* masthead title */}
      <div className="flex items-end justify-between gap-6 pt-5 max-[640px]:flex-col max-[640px]:items-start">
        <div>
          <h1 className="ed-display font-black text-[clamp(2.6rem,7vw,4.6rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)]">
            Job{' '}<span className="italic font-medium text-[var(--ed-accent)]">Discovery</span>
          </h1>
          <p className="mt-3 max-w-[560px] text-[0.95rem] leading-[1.6] text-[var(--ed-ink-soft)]">
            Collects jobs from LinkedIn and Indeed into your pool — automatically, on a nightly schedule.
            Matching against your profile happens on the Search page.
          </p>
        </div>
        <Button
          onClick={onNewCriteria}
          disabled={demoMode}
          title={demoMode ? DEMO_DISABLED_TITLE : undefined}
          className="shrink-0 rounded-full bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)] uppercase text-[0.7rem] font-semibold tracking-[0.08em]"
        >
          + New Criteria
        </Button>
      </div>

      {/* triple rule */}
      <div className="mt-5 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
    </header>
  );
}
