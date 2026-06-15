import { useState, useEffect } from 'react';
import { Trash2, Plus, ArrowUp, ArrowDown, ListChecks, AlignLeft, RefreshCw } from 'lucide-react';
import { useInterviewPrep, useInterviewPrepHistory } from '../lib/queries';
import { useSaveInterviewPrep, useRestoreInterviewPrepHistory, useGeneratePresentationCues } from '../lib/mutations';
import type { InterviewPrepResponse, InterviewPrepHistoryField, QaEntry } from '../lib/types';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import {
  SaveResult,
  IntroTextarea,
  HistoryDropdown,
  type SaveResultData,
} from '../components/settings-shared';

/* Thin wrapper binding the shared dropdown to the interview-prep hooks. */
function HistoryButton({ field, onRestored }: { field: InterviewPrepHistoryField; onRestored: (data: InterviewPrepResponse) => void }) {
  return (
    <HistoryDropdown<InterviewPrepHistoryField, InterviewPrepResponse>
      field={field}
      onRestored={onRestored}
      useHistory={useInterviewPrepHistory}
      useRestore={useRestoreInterviewPrepHistory}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Q&A rubric editor                                                  */
/* ------------------------------------------------------------------ */
function QaRubricEditor({ entries, onChange }: { entries: QaEntry[]; onChange: (next: QaEntry[]) => void }) {
  function update(idx: number, patch: Partial<QaEntry>): void {
    onChange(entries.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function remove(idx: number): void {
    onChange(entries.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1): void {
    const target = idx + dir;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }
  function add(): void {
    onChange([...entries, { question: '', answer: '' }]);
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.length === 0 && (
        <p className="text-[0.82rem] text-muted-foreground italic">
          No questions yet. Add prepared answers to common interview questions like "Where do you see yourself in 5 years?".
        </p>
      )}
      {entries.map((e, idx) => (
        <div key={idx} className="border border-border rounded-lg p-[1rem_1.15rem] bg-card relative">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold">
              Question {idx + 1}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                aria-label="Move up"
                className="h-7 w-7 p-0"
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => move(idx, 1)}
                disabled={idx === entries.length - 1}
                aria-label="Move down"
                className="h-7 w-7 p-0"
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove(idx)}
                aria-label="Remove question"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          <input
            className="w-full mb-2 p-[0.6rem_0.85rem] border border-border rounded-md text-foreground text-[0.88rem] font-medium outline-none transition-all hover:border-muted-foreground/30 focus:border-ring bg-background"
            placeholder="Question (e.g. Where do you see yourself in 5 years?)"
            value={e.question}
            onChange={(ev) => update(idx, { question: ev.target.value })}
            dir="auto"
          />
          <textarea
            className="w-full p-[0.75rem_0.95rem] border border-border rounded-md text-foreground text-[0.88rem] resize-y outline-none leading-[1.7] whitespace-pre-wrap transition-all hover:border-muted-foreground/30 focus:border-ring bg-background"
            style={{ minHeight: '120px' }}
            placeholder="Your prepared answer / rubric for answering this question"
            value={e.answer}
            onChange={(ev) => update(idx, { answer: ev.target.value })}
            dir="auto"
            spellCheck={false}
          />
        </div>
      ))}
      <div>
        <Button variant="outline" size="sm" onClick={add} className="gap-[0.4rem]">
          <Plus size={14} /> Add question
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section header                                                     */
/* ------------------------------------------------------------------ */
function SectionHeader({ num, name, desc }: { num: string; name: string; desc: string }) {
  return (
    <>
      <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border">
        <span className="font-serif text-[2.4rem] font-bold text-muted-foreground leading-none">{num}</span>
        <span className="font-serif text-[1.55rem] font-bold text-foreground leading-tight">{name}</span>
      </div>
      <p className="text-[0.92rem] text-muted-foreground leading-[1.6] mb-5">{desc}</p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Self-presentation field — full text  ⇄  keyword cues               */
/* ------------------------------------------------------------------ */
const PRESENTATION_TEXTAREA_CLASS =
  'w-full p-[1rem_1.25rem] border border-border rounded-lg text-foreground text-[0.88rem] resize-y outline-none leading-[1.8] whitespace-pre-wrap transition-all hover:border-muted-foreground/30 focus:border-ring focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,0,0,0.04)] selection:bg-primary/10 selection:text-foreground';

/* One cue line — split a leading "topic — keywords" so the topic reads bolder. */
function CueLine({ text }: { text: string }) {
  const sep = ['—', '–', ' - '].map((s) => text.indexOf(s)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  let lead = '';
  let rest = text;
  if (sep !== undefined && sep > 0) {
    const sepChar = text[sep] === ' ' ? ' - ' : text[sep];
    lead = text.slice(0, sep).trim();
    rest = text.slice(sep + sepChar.length).trim();
  }
  // dir="rtl" + text-right (matching the Signals lines): forces a Hebrew base
  // direction so mixed Hebrew/English lines read consistently — Latin runs
  // (Backend, NCR, .NET…) still render LTR within. dir="auto" was scrambling
  // order on English-leading lines.
  return (
    <span dir="rtl" className="text-right leading-[1.6]">
      {lead && <span className="font-semibold text-foreground">{lead} — </span>}
      <span className="text-muted-foreground">{rest}</span>
    </span>
  );
}

function PresentationField({ label, hint, value, onChange, minHeight }: { label: string; hint: string; value: string; onChange: (v: string) => void; minHeight: number }) {
  const [mode, setMode] = useState<'full' | 'cues'>('full');
  const [cues, setCues] = useState<string[] | null>(null);
  const [cuesFor, setCuesFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const gen = useGeneratePresentationCues();

  const hasText = value.trim().length > 0;
  const stale = cues !== null && cuesFor !== value;

  async function generate(): Promise<void> {
    setError(null);
    try {
      const res = await gen.mutateAsync(value);
      setCues(res.cues ?? []);
      setCuesFor(value);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function showCues(): void {
    setMode('cues');
    if (cues === null || cuesFor !== value) generate();
  }

  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-3 mb-[0.35rem] flex-wrap">
        <span className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]">
          <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
          {label}
        </span>
        {/* Full text ⇄ Keywords toggle */}
        <div className="inline-flex rounded-md border border-border overflow-hidden bg-muted/30 shrink-0">
          <button
            type="button"
            onClick={() => setMode('full')}
            className={`flex items-center gap-[0.35rem] px-[0.6rem] py-[0.3rem] text-[0.72rem] font-medium transition-colors ${mode === 'full' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <AlignLeft size={13} /> Full text
          </button>
          <button
            type="button"
            onClick={showCues}
            disabled={!hasText}
            title={hasText ? 'Show short keyword reminders' : 'Add some text first'}
            className={`flex items-center gap-[0.35rem] px-[0.6rem] py-[0.3rem] text-[0.72rem] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${mode === 'cues' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ListChecks size={13} /> Keywords
          </button>
        </div>
      </div>
      <p className="text-[0.78rem] text-muted-foreground leading-[1.55] mb-2">{hint}</p>

      {mode === 'full' ? (
        <textarea
          className={PRESENTATION_TEXTAREA_CLASS}
          style={{ minHeight: `${minHeight}px`, background: 'var(--card)' }}
          value={value}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          dir="auto"
          spellCheck={false}
        />
      ) : (
        <div
          className="border border-border rounded-lg bg-card p-[1.1rem_1.35rem]"
          style={{ minHeight: `${minHeight}px` }}
        >
          {gen.isPending && cues === null ? (
            <div className="flex items-center gap-2 text-[0.82rem] text-muted-foreground">
              <RefreshCw size={14} className="animate-spin" /> Distilling your key points…
            </div>
          ) : error ? (
            <div className="text-[0.82rem] text-destructive">
              Couldn't generate cues: {error}{' '}
              <button type="button" onClick={generate} className="underline underline-offset-2 hover:text-foreground">Retry</button>
            </div>
          ) : cues && cues.length > 0 ? (
            <>
              <ol className="flex flex-col gap-[0.7rem] m-0 p-0 list-none">
                {cues.map((c, i) => (
                  <li key={i} dir="rtl" className="flex items-start gap-[0.7rem] text-[0.9rem]">
                    <span className="shrink-0 mt-[0.05rem] w-[1.4rem] h-[1.4rem] rounded-full bg-muted text-muted-foreground text-[0.7rem] font-semibold flex items-center justify-center tabular-nums">{i + 1}</span>
                    <CueLine text={c} />
                  </li>
                ))}
              </ol>
              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-dashed border-border">
                <button
                  type="button"
                  onClick={generate}
                  disabled={gen.isPending}
                  className="inline-flex items-center gap-[0.35rem] text-[0.74rem] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={gen.isPending ? 'animate-spin' : ''} /> Regenerate
                </button>
                {stale && !gen.isPending && (
                  <span className="text-[0.72rem] text-amber-600">Text changed since these were generated.</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-[0.82rem] text-muted-foreground italic">No cues generated — the text may be too short.</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function InterviewPrepPage() {
  const query = useInterviewPrep();
  const saveMutation = useSaveInterviewPrep();
  const [initialized, setInitialized] = useState(false);

  const [hr, setHr] = useState('');
  const [originalHr, setOriginalHr] = useState('');
  const [tech, setTech] = useState('');
  const [originalTech, setOriginalTech] = useState('');
  const [work, setWork] = useState('');
  const [originalWork, setOriginalWork] = useState('');
  const [personal, setPersonal] = useState('');
  const [originalPersonal, setOriginalPersonal] = useState('');
  const [qa, setQa] = useState<QaEntry[]>([]);
  const [originalQa, setOriginalQa] = useState<QaEntry[]>([]);

  const [savingPresentation, setSavingPresentation] = useState(false);
  const [presentationResult, setPresentationResult] = useState<SaveResultData | null>(null);
  const [savingQa, setSavingQa] = useState(false);
  const [qaResult, setQaResult] = useState<SaveResultData | null>(null);
  const [savingProjects, setSavingProjects] = useState(false);
  const [projectsResult, setProjectsResult] = useState<SaveResultData | null>(null);

  // Reset all editor state (and its baseline) from a response. Used on first
  // load and after a history restore.
  function applyData(data: InterviewPrepResponse): void {
    const h = data?.self_presentation_hr || '';
    setHr(h); setOriginalHr(h);
    const t = data?.self_presentation_technical || '';
    setTech(t); setOriginalTech(t);
    const w = data?.presenting_work_project || '';
    setWork(w); setOriginalWork(w);
    const p = data?.presenting_personal_project || '';
    setPersonal(p); setOriginalPersonal(p);
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

  const isPresentationDirty = hr !== originalHr || tech !== originalTech;
  const isQaDirty = JSON.stringify(qa) !== JSON.stringify(originalQa);
  const isProjectsDirty = work !== originalWork || personal !== originalPersonal;

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

  const savePresentation = () => saveSection(
    { self_presentation_hr: hr, self_presentation_technical: tech },
    setSavingPresentation, setPresentationResult,
    () => { setOriginalHr(hr); setOriginalTech(tech); },
    'Self-presentation',
  );

  const saveQa = () => saveSection(
    { qa_rubric: qa },
    setSavingQa, setQaResult,
    (data) => {
      // Server trims fully-empty rows — re-sync from the response.
      const r = data?.qa_rubric ?? [];
      setQa(r); setOriginalQa(r);
    },
    'Question rubric',
  );

  const saveProjects = () => saveSection(
    { presenting_work_project: work, presenting_personal_project: personal },
    setSavingProjects, setProjectsResult,
    () => { setOriginalWork(work); setOriginalPersonal(personal); },
    'Project presentations',
  );

  if (query.isLoading) return <InterviewPrepLoadingSkeleton />;

  const error = query.error?.message ?? null;

  return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-16 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 max-sm:px-4 max-sm:pt-10 max-sm:pb-14">
      <header className="mb-14 relative py-[0.4rem]">
        <span className="inline-flex items-center gap-[0.55rem] font-mono text-[0.66rem] tracking-[0.3em] uppercase text-muted-foreground font-medium py-[0.32rem] pr-[0.95rem] pl-[0.7rem] border border-border rounded-full bg-muted/30 mb-[1.35rem]">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shadow-[0_0_0_3px_rgba(0,0,0,0.06)] shrink-0" />
          Interview Prep
        </span>
        <h1 className="font-serif text-[clamp(2.2rem,4.6vw,3.1rem)] font-bold text-foreground leading-[1.05] mb-3 tracking-[-0.018em]">Interview Prep</h1>
        <p className="text-muted-foreground text-[0.98rem] max-w-[600px] leading-[1.65]">
          Your personal interview playbook — values-based self-presentations, prepared answers to common questions, and how to walk through your projects. Each section is versioned, so you can restore a prior draft anytime.
        </p>
      </header>

      {error && (
        <div className="mb-8">
          <SaveResult result={{ type: 'error', message: `Failed to load: ${error}` }} />
        </div>
      )}

      {/* 01 — Self-presentation */}
      <section className="mb-16">
        <SectionHeader
          num="01"
          name="Self-presentation"
          desc="How you introduce yourself, grounded in your values. Keep two versions: one tuned for an HR/recruiter conversation, one for a technical interviewer."
        />
        <PresentationField
          label="HR / Recruiter version"
          hint="Values-first, accessible framing for a non-technical audience — who you are, what drives you, what you're looking for. Switch to Keywords to rehearse from memory."
          value={hr}
          onChange={(v) => { setHr(v); setPresentationResult(null); }}
          minHeight={220}
        />
        <PresentationField
          label="Technical version"
          hint="For a technical interviewer — your engineering values, depth, and how you work, still rooted in what matters to you. Switch to Keywords to rehearse from memory."
          value={tech}
          onChange={(v) => { setTech(v); setPresentationResult(null); }}
          minHeight={220}
        />
        <div className="flex justify-end items-center gap-[0.6rem] mt-2 pt-[1.1rem] border-t border-dashed border-border">
          <HistoryButton field="self_presentation_hr" onRestored={applyData} />
          <HistoryButton field="self_presentation_technical" onRestored={applyData} />
          {isPresentationDirty && (
            <Button variant="outline" size="sm" onClick={() => { setHr(originalHr); setTech(originalTech); setPresentationResult(null); }}>
              Discard changes
            </Button>
          )}
          <Button onClick={savePresentation} disabled={!isPresentationDirty || savingPresentation}>
            {savingPresentation ? 'Saving…' : 'Save self-presentation'}
          </Button>
        </div>
        {presentationResult && <SaveResult result={presentationResult} />}
      </section>

      {/* 02 — Popular questions rubric */}
      <section className="mb-16">
        <SectionHeader
          num="02"
          name="Question rubric"
          desc="Prepared answers to popular interview questions. Add, edit, reorder, or remove entries — each question pairs with your go-to answer."
        />
        <QaRubricEditor entries={qa} onChange={(next) => { setQa(next); setQaResult(null); }} />
        <div className="flex justify-end items-center gap-[0.6rem] mt-5 pt-[1.1rem] border-t border-dashed border-border">
          <HistoryButton field="qa_rubric" onRestored={applyData} />
          {isQaDirty && (
            <Button variant="outline" size="sm" onClick={() => { setQa(originalQa); setQaResult(null); }}>
              Discard changes
            </Button>
          )}
          <Button onClick={saveQa} disabled={!isQaDirty || savingQa}>
            {savingQa ? 'Saving…' : 'Save question rubric'}
          </Button>
        </div>
        {qaResult && <SaveResult result={qaResult} />}
      </section>

      {/* 03 — Project presentations */}
      <section className="mb-16">
        <SectionHeader
          num="03"
          name="Project presentations"
          desc="How you present projects when asked to walk through your work — one for a professional/work project, one for a personal project."
        />
        <IntroTextarea
          label="Work project"
          hint="A project from a job — context, your role, the problem, decisions and trade-offs, and the impact."
          value={work}
          onChange={(v) => { setWork(v); setProjectsResult(null); }}
          minHeight={220}
        />
        <IntroTextarea
          label="Personal project"
          hint="Something you built on your own — the motivation, what you learned, and what it shows about how you work."
          value={personal}
          onChange={(v) => { setPersonal(v); setProjectsResult(null); }}
          minHeight={220}
        />
        <div className="flex justify-end items-center gap-[0.6rem] mt-2 pt-[1.1rem] border-t border-dashed border-border">
          <HistoryButton field="presenting_work_project" onRestored={applyData} />
          <HistoryButton field="presenting_personal_project" onRestored={applyData} />
          {isProjectsDirty && (
            <Button variant="outline" size="sm" onClick={() => { setWork(originalWork); setPersonal(originalPersonal); setProjectsResult(null); }}>
              Discard changes
            </Button>
          )}
          <Button onClick={saveProjects} disabled={!isProjectsDirty || savingProjects}>
            {savingProjects ? 'Saving…' : 'Save project presentations'}
          </Button>
        </div>
        {projectsResult && <SaveResult result={projectsResult} />}
      </section>
    </div>
  );
}

function InterviewPrepLoadingSkeleton() {
  return (
    <div className="max-w-[960px] mx-auto px-7 pt-16 pb-32 max-sm:px-4">
      <Skeleton className="h-4 w-32 mb-6" />
      <Skeleton className="h-12 w-64 mb-3" />
      <Skeleton className="h-4 w-full max-w-[560px] mb-2" />
      <Skeleton className="h-4 w-3/4 max-w-[420px] mb-14" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-16">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-[160px] w-full" />
        </div>
      ))}
    </div>
  );
}
