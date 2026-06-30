import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Plus, ArrowUp, ArrowDown, ListChecks, AlignLeft, RefreshCw, MessageSquare } from 'lucide-react';
import { useInterviewPrep, useInterviewPrepHistory } from '../lib/queries';
import { useSaveInterviewPrep, useRestoreInterviewPrepHistory, useGeneratePresentationCues } from '../lib/mutations';
import type { InterviewPrepResponse, InterviewPrepHistoryField, QaEntry } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
import { AutoGrowTextarea } from '../components/AutoGrowTextarea';
import {
  SaveResult,
  IntroTextarea,
  HistoryDropdown,
  type SaveResultData,
} from '../components/settings-shared';

const ED_BTN = 'rounded-none border px-3.5 py-[0.5rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;
const ED_DANGER = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10`;

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

  const iconBtn = 'h-7 w-7 p-0 inline-flex items-center justify-center rounded-none text-[var(--ed-ink-soft)] transition-colors hover:text-[var(--ed-ink)] disabled:opacity-40 disabled:pointer-events-none';
  return (
    <div className="flex flex-col gap-4">
      {entries.length === 0 && (
        <p className="text-[0.82rem] text-[var(--ed-ink-faint)] italic">
          No questions yet. Add prepared answers to common interview questions like "Where do you see yourself in 5 years?".
        </p>
      )}
      {entries.map((e, idx) => (
        <div key={idx} className="border border-[var(--ed-rule)] p-[1rem_1.15rem] bg-[var(--ed-panel)] relative">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[0.7rem] text-[var(--ed-ink-faint)] tracking-[0.14em] uppercase font-semibold">
              Question {idx + 1}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                aria-label="Move up"
                className={iconBtn}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === entries.length - 1}
                aria-label="Move down"
                className={iconBtn}
              >
                <ArrowDown size={14} />
              </button>
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label="Remove question"
                className={`${iconBtn} hover:text-[var(--ed-no)]`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <input
            className="w-full mb-2 p-[0.6rem_0.85rem] border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.88rem] font-medium outline-none transition-all hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] bg-[var(--ed-paper)]"
            placeholder="Question (e.g. Where do you see yourself in 5 years?)"
            value={e.question}
            onChange={(ev) => update(idx, { question: ev.target.value })}
            dir="auto"
          />
          <AutoGrowTextarea
            className="w-full p-[0.75rem_0.95rem] border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.88rem] outline-none leading-[1.7] whitespace-pre-wrap transition-all hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] bg-[var(--ed-paper)]"
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
        <button type="button" onClick={add} className={`${ED_GHOST} inline-flex items-center gap-[0.4rem]`}>
          <Plus size={14} /> Add question
        </button>
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
      <div className="flex items-baseline gap-4 mb-1 flex-wrap">
        <span className="ed-display font-black text-[2.4rem] text-[var(--ed-ink-faint)] leading-none">{num}</span>
        <span className="ed-display italic font-semibold text-[1.4rem] tracking-[-0.01em] text-[var(--ed-ink)] leading-tight">{name}</span>
      </div>
      <div className="border-t border-[var(--ed-rule-strong)] mb-4" />
      <p className="text-[0.92rem] text-[var(--ed-ink-soft)] leading-[1.6] mb-5">{desc}</p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Self-presentation field — full text  ⇄  keyword cues               */
/* ------------------------------------------------------------------ */
const PRESENTATION_TEXTAREA_CLASS =
  'w-full p-[1rem_1.25rem] border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.88rem] outline-none leading-[1.8] whitespace-pre-wrap transition-all hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] selection:bg-[var(--ed-accent)]/10 selection:text-[var(--ed-ink)] bg-[var(--ed-paper)]';

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
  // (Backend, AWS, React…) still render LTR within. dir="auto" was scrambling
  // order on English-leading lines.
  return (
    <span dir="rtl" className="text-right leading-[1.6]">
      {lead && <span className="font-semibold text-[var(--ed-ink)]">{lead} — </span>}
      <span className="text-[var(--ed-ink-soft)]">{rest}</span>
    </span>
  );
}

function PresentationField({ field, label, hint, value, savedValue, cachedCues, onChange, minHeight }: { field: InterviewPrepHistoryField; label: string; hint: string; value: string; savedValue: string; cachedCues: string[]; onChange: (v: string) => void; minHeight: number }) {
  const [mode, setMode] = useState<'full' | 'cues'>('full');
  const [localCues, setLocalCues] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gen = useGeneratePresentationCues();

  const dirty = value !== savedValue;          // unsaved edits in the editor
  const hasSaved = savedValue.trim().length > 0;
  // Freshly generated cues win; otherwise fall back to the cached set the doc
  // loaded with. Cues always reflect the *saved* version of the text.
  const cues = localCues ?? (cachedCues.length > 0 ? cachedCues : null);

  // When the saved baseline changes (a save or a history restore), the server
  // drops cues that no longer match the text — clear our local copy so we fall
  // back to the (possibly empty) cached set and regenerate on demand.
  useEffect(() => {
    setLocalCues(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedValue]);

  async function generate(force: boolean): Promise<void> {
    setError(null);
    try {
      const res = await gen.mutateAsync({ field, force });
      setLocalCues(res.cues ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function showCues(): void {
    setMode('cues');
    // Cached set absent → generate from the saved text (no call if we already
    // have cues, or if the field was never saved).
    if (hasSaved && cues === null && !gen.isPending) generate(false);
  }

  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-3 mb-[0.35rem] flex-wrap">
        <span className="text-[0.7rem] text-[var(--ed-ink-faint)] tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]">
          <span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-ink-faint)] opacity-45 shrink-0" />
          {label}
        </span>
        {/* Full text ⇄ Keywords toggle */}
        <div className="inline-flex border border-[var(--ed-rule)] overflow-hidden bg-[var(--ed-panel)] shrink-0">
          <button
            type="button"
            onClick={() => setMode('full')}
            className={`flex items-center gap-[0.35rem] px-[0.6rem] py-[0.3rem] text-[0.72rem] font-medium transition-colors ${mode === 'full' ? 'bg-[var(--ed-paper)] text-[var(--ed-ink)]' : 'text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)]'}`}
          >
            <AlignLeft size={13} /> Full text
          </button>
          <button
            type="button"
            onClick={showCues}
            className={`flex items-center gap-[0.35rem] px-[0.6rem] py-[0.3rem] text-[0.72rem] font-medium transition-colors ${mode === 'cues' ? 'bg-[var(--ed-paper)] text-[var(--ed-ink)]' : 'text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)]'}`}
          >
            <ListChecks size={13} /> Keywords
          </button>
        </div>
      </div>
      <p className="text-[0.78rem] text-[var(--ed-ink-faint)] leading-[1.55] mb-2">{hint}</p>

      {mode === 'full' ? (
        <AutoGrowTextarea
          className={PRESENTATION_TEXTAREA_CLASS}
          style={{ minHeight: `${minHeight}px` }}
          value={value}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          dir="auto"
          spellCheck={false}
        />
      ) : (
        <div
          className="border border-[var(--ed-rule)] bg-[var(--ed-panel)] p-[1.1rem_1.35rem]"
          style={{ minHeight: `${minHeight}px` }}
        >
          {gen.isPending && cues === null ? (
            <div className="flex items-center gap-2 text-[0.82rem] text-[var(--ed-ink-soft)]">
              <RefreshCw size={14} className="animate-spin" /> Distilling your key points…
            </div>
          ) : error ? (
            <div className="text-[0.82rem] text-[var(--ed-no)]">
              Couldn't generate cues: {error}{' '}
              <button type="button" onClick={() => generate(false)} className="underline underline-offset-2 hover:text-[var(--ed-ink)]">Retry</button>
            </div>
          ) : !hasSaved ? (
            <div className="text-[0.82rem] text-[var(--ed-ink-faint)] italic">Save your self-presentation first to generate keyword reminders.</div>
          ) : cues && cues.length > 0 ? (
            <>
              <ol className="flex flex-col gap-[0.7rem] m-0 p-0 list-none">
                {cues.map((c, i) => (
                  <li key={i} dir="rtl" className="flex items-start gap-[0.7rem] text-[0.9rem]">
                    <span className="shrink-0 mt-[0.05rem] w-[1.4rem] h-[1.4rem] rounded-full bg-[var(--ed-paper)] border border-[var(--ed-rule)] text-[var(--ed-ink-soft)] text-[0.7rem] font-semibold flex items-center justify-center tabular-nums">{i + 1}</span>
                    <CueLine text={c} />
                  </li>
                ))}
              </ol>
              <div className="flex items-center gap-3 mt-4 pt-3 border-t border-dashed border-[var(--ed-rule)]">
                <button
                  type="button"
                  onClick={() => generate(true)}
                  disabled={gen.isPending}
                  className="inline-flex items-center gap-[0.35rem] text-[0.74rem] font-medium text-[var(--ed-ink-soft)] hover:text-[var(--ed-ink)] transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={gen.isPending ? 'animate-spin' : ''} /> Regenerate
                </button>
                {dirty && !gen.isPending && (
                  <span className="text-[0.72rem] text-[var(--ed-gold)]">Based on your saved version — save to refresh.</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-[0.82rem] text-[var(--ed-ink-faint)] italic">No cues generated — the text may be too short.</div>
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
  const prepData = query.data as InterviewPrepResponse | undefined;

  return (
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
      <header className="mb-9">
        <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
          <span>Vol. III · Interview Prep</span>
          <span className="hidden sm:block text-[var(--ed-accent)]">Rehearse with intent</span>
        </div>
        <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">
          Interview <span className="italic font-medium text-[var(--ed-accent)]">Prep</span>
        </h1>
        <p className="mt-3 max-w-[600px] text-[0.95rem] leading-[1.6] text-[var(--ed-ink-soft)]">
          Your personal interview playbook — values-based self-presentations, prepared answers to common questions, and how to walk through your projects. Each section is versioned, so you can restore a prior draft anytime.
        </p>
        <div className="mt-5">
          <Link to="/practice-interview" className={`${ED_PRIMARY} inline-flex items-center gap-[0.45rem]`}>
            <MessageSquare size={15} /> Start a practice interview
          </Link>
        </div>
        <div className="mt-5 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
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
          field="self_presentation_hr"
          label="HR / Recruiter version"
          hint="Values-first, accessible framing for a non-technical audience — who you are, what drives you, what you're looking for. Switch to Keywords to rehearse from memory."
          value={hr}
          savedValue={originalHr}
          cachedCues={prepData?.self_presentation_hr_cues ?? []}
          onChange={(v) => { setHr(v); setPresentationResult(null); }}
          minHeight={220}
        />
        <PresentationField
          field="self_presentation_technical"
          label="Technical version"
          hint="For a technical interviewer — your engineering values, depth, and how you work, still rooted in what matters to you. Switch to Keywords to rehearse from memory."
          value={tech}
          savedValue={originalTech}
          cachedCues={prepData?.self_presentation_technical_cues ?? []}
          onChange={(v) => { setTech(v); setPresentationResult(null); }}
          minHeight={220}
        />
        <div className="flex justify-end items-center gap-[0.6rem] mt-2 pt-[1.1rem] border-t border-dashed border-[var(--ed-rule)]">
          <HistoryButton field="self_presentation_hr" onRestored={applyData} />
          <HistoryButton field="self_presentation_technical" onRestored={applyData} />
          {isPresentationDirty && (
            <button type="button" className={ED_DANGER} onClick={() => { setHr(originalHr); setTech(originalTech); setPresentationResult(null); }}>
              Discard changes
            </button>
          )}
          <button type="button" className={ED_PRIMARY} onClick={savePresentation} disabled={!isPresentationDirty || savingPresentation}>
            {savingPresentation ? 'Saving…' : 'Save self-presentation'}
          </button>
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
        <div className="flex justify-end items-center gap-[0.6rem] mt-5 pt-[1.1rem] border-t border-dashed border-[var(--ed-rule)]">
          <HistoryButton field="qa_rubric" onRestored={applyData} />
          {isQaDirty && (
            <button type="button" className={ED_DANGER} onClick={() => { setQa(originalQa); setQaResult(null); }}>
              Discard changes
            </button>
          )}
          <button type="button" className={ED_PRIMARY} onClick={saveQa} disabled={!isQaDirty || savingQa}>
            {savingQa ? 'Saving…' : 'Save question rubric'}
          </button>
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
        <div className="flex justify-end items-center gap-[0.6rem] mt-2 pt-[1.1rem] border-t border-dashed border-[var(--ed-rule)]">
          <HistoryButton field="presenting_work_project" onRestored={applyData} />
          <HistoryButton field="presenting_personal_project" onRestored={applyData} />
          {isProjectsDirty && (
            <button type="button" className={ED_DANGER} onClick={() => { setWork(originalWork); setPersonal(originalPersonal); setProjectsResult(null); }}>
              Discard changes
            </button>
          )}
          <button type="button" className={ED_PRIMARY} onClick={saveProjects} disabled={!isProjectsDirty || savingProjects}>
            {savingProjects ? 'Saving…' : 'Save project presentations'}
          </button>
        </div>
        {projectsResult && <SaveResult result={projectsResult} />}
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
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-16">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-[160px] w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
