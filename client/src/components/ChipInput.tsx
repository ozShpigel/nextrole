import { useState, type KeyboardEvent } from 'react';

interface ChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
  dir?: 'auto' | 'ltr' | 'rtl';
  /** Curated quick-add presets, shown below the input; already-added ones are hidden. */
  suggestions?: string[];
}

// Editorial-palette tag input over a flat string[]. Each item is a removable
// chip; the trailing text box adds items on Enter / comma / blur / +Add.
// De-dupes case-insensitively and trims — mirrors the csv()/lines() cleanup the
// profile fields used before, so re-saving stays stable.
export function ChipInput({ value, onChange, placeholder, ariaLabel, dir = 'auto', suggestions }: ChipInputProps) {
  const [draft, setDraft] = useState('');

  const present = new Set(value.map((v) => v.toLowerCase()));
  const quickAdd = (suggestions ?? []).filter((s) => !present.has(s.toLowerCase()));

  // Add one or more items (comma-split), trimmed and de-duped against the
  // existing values (case-insensitive). Returns nothing — commits via onChange.
  function commit(raw: string): void {
    const existing = new Set(value.map((v) => v.toLowerCase()));
    const additions: string[] = [];
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      additions.push(trimmed);
    }
    if (additions.length > 0) onChange([...value, ...additions]);
    setDraft('');
  }

  function remove(index: number): void {
    onChange(value.filter((_, i) => i !== index));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      remove(value.length - 1);
    }
  }

  return (
    <div className="flex flex-col gap-[0.4rem]">
    <div className="flex flex-wrap items-center gap-[0.4rem] p-[0.5rem] border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 transition-colors focus-within:border-[var(--ed-accent)] hover:border-[var(--ed-ink-faint)]">
      {value.map((item, i) => (
        <span
          key={`${item}-${i}`}
          dir={dir}
          className="inline-flex items-center gap-[0.4rem] py-[0.2rem] pl-[0.55rem] pr-[0.3rem] border border-[var(--ed-rule)] bg-[var(--ed-panel)] text-[var(--ed-ink)] text-[0.78rem] font-code"
        >
          <span>{item}</span>
          <button
            type="button"
            aria-label={`Remove ${item}`}
            onClick={() => remove(i)}
            className="inline-flex items-center justify-center w-[1.05rem] h-[1.05rem] leading-none text-[var(--ed-ink-faint)] hover:text-[var(--ed-no)] transition-colors"
          >
            ×
          </button>
        </span>
      ))}
      <div className="flex items-center gap-[0.4rem] flex-1 min-w-[8rem]">
        <input
          type="text"
          dir={dir}
          aria-label={ariaLabel ?? placeholder}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          className="flex-1 min-w-[6rem] bg-transparent text-[var(--ed-ink)] text-[0.82rem] font-code outline-none placeholder:text-[var(--ed-ink-faint)]"
        />
        {draft.trim() && (
          <button
            type="button"
            onClick={() => commit(draft)}
            className="shrink-0 px-[0.5rem] py-[0.2rem] border border-[var(--ed-rule)] text-[var(--ed-ink-soft)] text-[0.64rem] font-semibold uppercase tracking-[0.08em] hover:border-[var(--ed-accent)] hover:text-[var(--ed-accent)] transition-colors"
          >
            + Add
          </button>
        )}
      </div>
    </div>
    {quickAdd.length > 0 && (
      <div className="flex flex-wrap items-center gap-[0.3rem]">
        <span className="text-[0.6rem] text-[var(--ed-ink-faint)] tracking-[0.1em] uppercase font-semibold mr-[0.15rem]">Quick add</span>
        {quickAdd.map((s) => (
          <button
            key={s}
            type="button"
            dir={dir}
            onClick={() => commit(s)}
            className="py-[0.15rem] px-[0.5rem] border border-dashed border-[var(--ed-rule)] text-[var(--ed-ink-soft)] text-[0.72rem] font-code hover:border-[var(--ed-accent)] hover:text-[var(--ed-accent)] transition-colors"
          >
            + {s}
          </button>
        ))}
      </div>
    )}
    </div>
  );
}
