import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Sparkles } from 'lucide-react';
import { useInterviewPrep, useDemoMode, DEMO_DISABLED_TITLE } from '../lib/queries';
import { useSaveInterviewPrep } from '../lib/mutations';
import type { InterviewPrepResponse, QaEntry } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
import { QaCardGrid } from '../components/QaCardGrid';
import {
  SaveResult,
  type SaveResultData,
} from '../components/settings-shared';

const ED_BTN = 'rounded-full border px-3.5 py-[0.5rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;
const ED_DANGER = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10`;

/* ------------------------------------------------------------------ */
/* Section header                                                     */
/* ------------------------------------------------------------------ */
function SectionHeader({ name }: { name: string }) {
  return (
    <div className="pb-3 mb-5 border-b border-[var(--ed-rule-strong)]">
      <h2 className="text-[16px] font-medium text-[var(--ed-ink)]">{name}</h2>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function InterviewPrepPage() {
  const demoMode = useDemoMode();
  const query = useInterviewPrep();
  const saveMutation = useSaveInterviewPrep();
  const [initialized, setInitialized] = useState(false);

  const [qa, setQa] = useState<QaEntry[]>([]);
  const [originalQa, setOriginalQa] = useState<QaEntry[]>([]);

  const [savingQa, setSavingQa] = useState(false);
  const [qaResult, setQaResult] = useState<SaveResultData | null>(null);

  // Reset all editor state (and its baseline) from a response. Used on first
  // load and after a history restore.
  function applyData(data: InterviewPrepResponse): void {
    const r = data?.qa_rubric ?? [];
    setQa(r); setOriginalQa(r);
  }

  useEffect(() => {
    if (query.data && !initialized) {
      applyData(query.data as InterviewPrepResponse);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, initialized]);

  const isQaDirty = JSON.stringify(qa) !== JSON.stringify(originalQa);

  async function saveSection(
    body: Record<string, unknown>,
    setSaving: React.Dispatch<React.SetStateAction<boolean>>,
    setResult: React.Dispatch<React.SetStateAction<SaveResultData | null>>,
    onSuccess: (data: InterviewPrepResponse) => void,
    label: string,
  ): Promise<void> {
    setSaving(true);
    setResult(null);
    try {
      const data = await saveMutation.mutateAsync(body) as InterviewPrepResponse;
      onSuccess(data);
      setResult({ type: 'success', message: `${label} saved successfully` });
    } catch (e) {
      setResult({ type: 'error', message: `Error saving: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  const saveQa = () => saveSection(
    { qa_rubric: qa },
    setSavingQa, setQaResult,
    (data) => {
      // Server trims fully-empty rows — re-sync from the response.
      const r = data?.qa_rubric ?? [];
      setQa(r); setOriginalQa(r);
    },
    'Interview questions',
  );

  if (query.isLoading) return <InterviewPrepLoadingSkeleton />;

  const error = query.error?.message ?? null;

  return (
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
      <header className="mb-9 pb-4 border-b border-[var(--ed-rule)]">
        <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)]">
          Interview <span className="italic font-medium text-[var(--ed-accent)]">Prep</span>
        </h1>
        <div className="mt-5 flex items-center gap-5 flex-wrap">
          {demoMode ? (
            <button
              type="button"
              disabled
              title={DEMO_DISABLED_TITLE}
              className={`${ED_PRIMARY} inline-flex items-center gap-[0.45rem]`}
            >
              <MessageSquare size={15} /> Start a practice interview
            </button>
          ) : (
            <Link to="/practice-interview" className={`${ED_PRIMARY} inline-flex items-center gap-[0.45rem]`}>
              <MessageSquare size={15} /> Start a practice interview
            </Link>
          )}
          <Link
            to="/interview-insights"
            className="inline-flex items-center gap-[0.4rem] text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-soft)] transition-colors hover:text-[var(--ed-ink)]"
          >
            <Sparkles size={13} /> Interview Insights
          </Link>
        </div>
      </header>

      {error && (
        <div className="mb-8">
          <SaveResult result={{ type: 'error', message: `Failed to load: ${error}` }} />
        </div>
      )}

      <section className="mb-16">
        <SectionHeader name="Interview Questions" />
        <QaCardGrid entries={qa} onChange={(next) => { setQa(next); setQaResult(null); }} />
        <div className="flex justify-end items-center gap-[0.6rem] mt-5 pt-[1.1rem] border-t border-dashed border-[var(--ed-rule)]">
          {isQaDirty && (
            <button type="button" className={ED_DANGER} onClick={() => { setQa(originalQa); setQaResult(null); }}>
              Discard changes
            </button>
          )}
          <button
            type="button"
            className={ED_PRIMARY}
            onClick={saveQa}
            disabled={!isQaDirty || savingQa || demoMode}
            title={demoMode ? DEMO_DISABLED_TITLE : undefined}
          >
            {savingQa ? 'Saving…' : 'Save interview questions'}
          </button>
        </div>
        {qaResult && <SaveResult result={qaResult} />}
      </section>
    </div>
    </div>
  );
}

function InterviewPrepLoadingSkeleton() {
  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-12 pb-20 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
        <Skeleton className="h-4 w-32 mb-6" />
        <Skeleton className="h-12 w-64 mb-3" />
        <Skeleton className="h-4 w-full max-w-[560px] mb-2" />
        <Skeleton className="h-4 w-3/4 max-w-[420px] mb-14" />
        <div className="mb-16">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-[160px] w-full" />
        </div>
      </div>
    </div>
  );
}
