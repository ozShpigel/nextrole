import { QA_CATEGORIES, type QaCategory } from '../lib/types';

// Tone per fixed category, mapped onto the editorial palette. Only used for
// the 'editorial' variant — the 'neutral' variant (portal-rendered dialogs,
// which sit outside the .editorial subtree where --ed-* doesn't resolve)
// uses plain shadcn semantic tokens instead.
const CATEGORY_TONE: Record<QaCategory, string> = {
  HR: '--ed-gold',
  Technical: '--ed-accent',
  Behavioral: '--ed-yes',
};

/* Fixed-set toggle chips for the HR/Technical/Behavioral category vocabulary.
 * Shared between the Q&A rubric (question categories, editorial page) and
 * interview retros (retro category tags, portal-rendered modal). */
export function CategoryToggleChips({
  value,
  onChange,
  variant = 'editorial',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  variant?: 'editorial' | 'neutral';
}) {
  return (
    <div className="flex items-center gap-[0.4rem] flex-wrap">
      {QA_CATEGORIES.map((cat) => {
        const selected = value.includes(cat);
        const toggle = () => onChange(selected ? value.filter((c) => c !== cat) : [...value, cat]);
        if (variant === 'neutral') {
          return (
            <button
              key={cat}
              type="button"
              aria-pressed={selected}
              onClick={toggle}
              className={`rounded-full border px-2 py-[0.2rem] text-[0.64rem] font-semibold uppercase tracking-[0.1em] transition-all ${
                selected ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {cat}
            </button>
          );
        }
        const tone = CATEGORY_TONE[cat];
        return (
          <button
            key={cat}
            type="button"
            aria-pressed={selected}
            onClick={toggle}
            className="rounded-full border px-2 py-[0.2rem] text-[0.64rem] font-semibold uppercase tracking-[0.1em] transition-all"
            style={selected
              ? { borderColor: `var(${tone})`, color: `var(${tone})`, background: `color-mix(in oklab, var(${tone}) 10%, transparent)` }
              : { borderColor: 'var(--ed-rule)', color: 'var(--ed-ink-faint)' }}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}
