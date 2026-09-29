import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useFeatures, type FeatureName } from '../lib/queries';

// Coming-soon features (docs/plans/feature-gating.md): visible, locked, and
// enforced server-side. These components only decide what to render.

const FEATURE_COPY: Record<FeatureName, { title: string; description: string }> = {
  AutoUpdate: {
    title: 'Auto-update',
    description: 'Moves your cards on the board by itself when recruiting emails arrive: interview invites, rejections and offers.',
  },
  AutoApply: {
    title: 'One-click apply',
    description: "Sends your tailored résumé pack to the employer in one click, without leaving NextRole.",
  },
  PracticeInterview: {
    title: 'Practice interview',
    description: 'A chat-based practice interview that asks, follows up on your answers and gives feedback.',
  },
  InterviewInsights: {
    title: 'Interview insights',
    description: 'Patterns across your interview retros: what went well, and what to work on.',
  },
};

/**
 * Whether this visitor may use a feature. `undefined` while the answer is
 * loading -- callers render nothing yet rather than flash the wrong state.
 * A failed request reads as locked: the server refuses the feature anyway.
 */
export function useCanUse(feature: FeatureName): boolean | undefined {
  const { data, isLoading } = useFeatures();
  if (isLoading) return undefined;
  return data?.[feature] === true;
}

/** The neutral outline pill (StatusBadge's style): never accent, which marks the primary action. */
export function ComingSoonPill() {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--ed-rule)] py-[0.1rem] px-[0.5rem] text-[13px] font-medium uppercase tracking-[0.06em] leading-[1.3] text-[var(--ed-ink-soft)]">
      Coming soon
    </span>
  );
}

// Portaled: --ed-* does not resolve here (docs/design-system.md), so shadcn's
// semantic tokens only, like every other dialog in the app.
export function ComingSoonDialog(
  { feature, open, onOpenChange }: { feature: FeatureName; open: boolean; onOpenChange: (open: boolean) => void },
) {
  const copy = FEATURE_COPY[feature];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <Lock size={16} aria-hidden="true" className="text-muted-foreground" />
            {copy.title} is coming soon
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A locked control: looks like the real one, says "Coming soon", and opens
 * the dialog. aria-disabled, never `disabled` -- a disabled button takes no
 * focus and no click, so it could neither be reached nor explain itself.
 */
export function LockedButton(
  { feature, className, children }: { feature: FeatureName; className: string; children: ReactNode },
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        className={`${className} inline-flex items-center gap-[0.4rem] opacity-70 cursor-pointer`}
        onClick={() => setOpen(true)}
      >
        <Lock size={12} aria-hidden="true" />
        {children}
        <ComingSoonPill />
      </button>
      <ComingSoonDialog feature={feature} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * A whole page behind a feature: the page for a visitor who may use it, a
 * locked notice for one who may not, nothing while the answer loads. Guards
 * the route itself, so a typed-in URL is locked too -- the server refuses its
 * API either way.
 */
export function FeatureRoute(
  { feature, backTo, backLabel, children }: { feature: FeatureName; backTo: string; backLabel: string; children: ReactNode },
) {
  const canUse = useCanUse(feature);
  if (canUse === undefined) return null;
  if (canUse) return <>{children}</>;

  const copy = FEATURE_COPY[feature];
  return (
    <div className="editorial min-h-[calc(100vh-56px)] flex items-center justify-center p-8">
      <div className="max-w-[440px] text-center">
        <Lock size={20} aria-hidden="true" className="mx-auto mb-4 text-[var(--ed-ink-faint)]" />
        <h1 className="text-[16px] font-medium text-[var(--ed-ink)]">{copy.title} is coming soon</h1>
        <p className="mt-2 text-[13px] text-[var(--ed-ink-soft)]">{copy.description}</p>
        <Link to={backTo} className="mt-6 inline-block text-[13px] font-medium text-[var(--ed-accent)]">
          &larr; {backLabel}
        </Link>
      </div>
    </div>
  );
}
