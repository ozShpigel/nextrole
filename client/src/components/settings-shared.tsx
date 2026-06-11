import { useState } from 'react';
import { Button } from './ui/button';
import type { ProfileHistoryResponse, ProfileHistoryEntry } from '../lib/types';

/* ------------------------------------------------------------------ */
/* Save Result                                                        */
/* ------------------------------------------------------------------ */
export interface SaveResultData {
  type: 'success' | 'error';
  message: string;
}

export function SaveResult({ result }: { result: SaveResultData }) {
  const isSuccess = result.type === 'success';
  return (
    <div
      className={`flex items-center gap-[0.65rem] mt-4 p-[0.8rem_1.1rem] rounded text-[0.84rem] font-medium border animate-in fade-in duration-200 relative overflow-hidden ${
        isSuccess
          ? 'bg-emerald-50/70 border-emerald-200/50 text-emerald-700'
          : 'bg-red-50/70 border-red-200/50 text-red-700'
      }`}
    >
      <span className="w-[18px] h-[18px] rounded-full bg-current opacity-15 shrink-0 relative" />
      <span
        className="absolute left-[1.1rem] top-1/2 -translate-y-1/2 w-[18px] h-[18px]"
        style={{
          background: isSuccess
            ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%232d8f5e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='5,10.5 9,14.5 15.5,7'/%3E%3C/svg%3E\") center / 12px no-repeat"
            : "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23c45454' stroke-width='2.5' stroke-linecap='round'%3E%3Cline x1='10' y1='5' x2='10' y2='11.5'/%3E%3Ccircle cx='10' cy='14.5' r='0.5'/%3E%3C/svg%3E\") center / 12px no-repeat",
        }}
      />
      {result.message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Intro Textarea                                                     */
/* ------------------------------------------------------------------ */
export function IntroTextarea({ label, hint, value, onChange, minHeight }: { label: string; hint: string; value: string; onChange: (v: string) => void; minHeight: number }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline gap-[0.45rem] mb-[0.35rem]">
        <span className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]">
          <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
          {label}
        </span>
      </div>
      <p className="text-[0.78rem] text-muted-foreground leading-[1.55] mb-2">{hint}</p>
      <textarea
        className="w-full p-[1rem_1.25rem] border border-border rounded-lg text-foreground text-[0.88rem] resize-y outline-none leading-[1.8] whitespace-pre-wrap transition-all hover:border-muted-foreground/30 focus:border-ring focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,0,0,0.04)] selection:bg-primary/10 selection:text-foreground"
        style={{ minHeight: `${minHeight}px`, background: 'var(--card)' }}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        dir="auto"
        spellCheck={false}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* History Button + dropdown (generic over field/restored-data type)  */
/* ------------------------------------------------------------------ */
export function formatHistoryDate(iso?: string | null): string {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown date';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface HistoryHookResult {
  data?: ProfileHistoryResponse;
  isLoading: boolean;
}

interface RestoreHook<TField extends string> {
  mutateAsync: (vars: { field: TField; index: number }) => Promise<unknown>;
  isPending: boolean;
}

// The two hooks are passed in (not called here directly) so this dropdown can
// be reused by both the profile editor and the interview-prep editor, each
// supplying its own query/restore hooks bound to its own endpoints.
export function HistoryDropdown<TField extends string, TData>({
  field,
  onRestored,
  useHistory,
  useRestore,
}: {
  field: TField;
  onRestored: (data: TData) => void;
  useHistory: (field: TField, enabled: boolean) => HistoryHookResult;
  useRestore: () => RestoreHook<TField>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const { data, isLoading } = useHistory(field, open);
  const restore = useRestore();
  const entries: ProfileHistoryEntry[] = data?.entries ?? [];

  async function doRestore(index: number): Promise<void> {
    const updated = (await restore.mutateAsync({ field, index })) as TData;
    onRestored(updated);
    setConfirmIdx(null);
    setOpen(false);
  }

  return (
    <div className="relative inline-block">
      <Button
        variant="outline"
        size="sm"
        onClick={() => { setOpen(v => !v); setConfirmIdx(null); }}
        title="View and restore previous versions"
      >
        History
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-[min(28rem,90vw)] max-h-[26rem] overflow-auto p-2 rounded-lg border border-border bg-popover shadow-lg animate-in fade-in slide-in-from-top-1 duration-150">
          {isLoading ? (
            <div className="p-3 text-[0.8rem] text-muted-foreground">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="p-3 text-[0.8rem] text-muted-foreground">No previous versions yet. Saving a change here will start the history.</div>
          ) : (
            entries.map((e) => (
              <div key={e.index} className="flex flex-col gap-[0.4rem] p-[0.6rem_0.7rem] rounded-md hover:bg-accent/50 border-b border-border last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[0.74rem] font-medium text-foreground tabular-nums">{formatHistoryDate(e.savedAt)}</span>
                  <span className="text-[0.68rem] text-muted-foreground tabular-nums">{e.length.toLocaleString()} chars</span>
                </div>
                <pre className="text-[0.72rem] leading-[1.5] text-muted-foreground whitespace-pre-wrap break-words max-h-[4.5rem] overflow-hidden m-0" dir="auto">{e.preview}</pre>
                <div className="flex justify-end gap-2">
                  {confirmIdx === e.index ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setConfirmIdx(null)} disabled={restore.isPending}>Cancel</Button>
                      <Button size="sm" onClick={() => doRestore(e.index)} disabled={restore.isPending}>
                        {restore.isPending ? 'Restoring…' : 'Confirm restore'}
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setConfirmIdx(e.index)}>Restore this version</Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
