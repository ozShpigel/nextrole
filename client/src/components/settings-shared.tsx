import { AutoGrowTextarea } from './AutoGrowTextarea';

/* ------------------------------------------------------------------ */
/* Save Result                                                        */
/* ------------------------------------------------------------------ */
export interface SaveResultData {
  type: 'success' | 'error';
  message: string;
}

export function SaveResult({ result }: { result: SaveResultData }) {
  const isSuccess = result.type === 'success';
  const tone = isSuccess ? 'var(--ed-yes)' : 'var(--ed-no)';
  return (
    <div
      className="flex items-center gap-[0.65rem] mt-4 p-[0.8rem_1.1rem] rounded text-[0.84rem] font-medium border animate-in fade-in duration-200 relative overflow-hidden"
      style={{
        color: tone,
        backgroundColor: `color-mix(in oklab, ${tone} 10%, transparent)`,
        borderColor: `color-mix(in oklab, ${tone} 30%, transparent)`,
      }}
    >
      <span className="w-[18px] h-[18px] rounded-full bg-current opacity-15 shrink-0 relative" />
      {/* stroke="currentColor" so the icon always matches the tone above,
          instead of a hardcoded hex baked into the SVG data URI. */}
      <span
        className="absolute left-[1.1rem] top-1/2 -translate-y-1/2 w-[18px] h-[18px]"
        style={{
          background: isSuccess
            ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='5,10.5 9,14.5 15.5,7'/%3E%3C/svg%3E\") center / 12px no-repeat"
            : "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round'%3E%3Cline x1='10' y1='5' x2='10' y2='11.5'/%3E%3Ccircle cx='10' cy='14.5' r='0.5'/%3E%3C/svg%3E\") center / 12px no-repeat",
          color: tone,
        }}
      />
      {result.message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Intro Textarea                                                     */
/* ------------------------------------------------------------------ */
export function IntroTextarea({ label, placeholder, value, onChange, minHeight }: { label: string; placeholder?: string; value: string; onChange: (v: string) => void; minHeight: number }) {
  return (
    <div className="mb-5">
      <AutoGrowTextarea
        className="w-full p-[1rem_1.25rem] border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.88rem] outline-none leading-[1.8] whitespace-pre-wrap transition-all hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] selection:bg-[var(--ed-accent)]/10 selection:text-[var(--ed-ink)] bg-[var(--ed-paper)] placeholder:text-[var(--ed-ink-faint)] placeholder:italic"
        style={{ minHeight: `${minHeight}px` }}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        dir="auto"
        spellCheck={false}
      />
    </div>
  );
}

