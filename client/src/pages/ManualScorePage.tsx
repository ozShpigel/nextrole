import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Check } from 'lucide-react';
import { useAddApplication } from '../lib/mutations';
import type { MatchResponse, ImportJobResult } from '../lib/types';
import AnalysisCard from '../components/AnalysisCard';
import { InterviewModal } from '../components/Interviews';
import { ScoreJobModal, type ScoredJob } from '../components/ScoreJobModal';
import { STATUS_LABELS } from '../lib/tracker';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

// Analyzing is the discovery pipeline's pre-decision state — a job you scored
// and chose to save has, by definition, moved past it.
const SAVE_STATUSES = Object.entries(STATUS_LABELS).filter(([value]) => value !== 'Analyzing');

const ED_BTN = 'rounded-full border px-4 py-[0.55rem] text-[0.7rem] font-semibold uppercase tracking-[0.1em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;

interface SavedRef {
  id: string;
}

export default function ManualScorePage() {
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [imported, setImported] = useState<ImportJobResult[]>([]);

  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [description, setDescription] = useState('');

  const [result, setResult] = useState<MatchResponse | null>(null);
  const [status, setStatus] = useState('DecidedToApply');
  const [saved, setSaved] = useState<SavedRef | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showInterviewModal, setShowInterviewModal] = useState(false);
  const [interviewScheduled, setInterviewScheduled] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);

  const addApplication = useAddApplication();

  // The save needs a job title + company. Prefer what the user typed; fall back
  // to what the analyst extracted from the description.
  const resolvedTitle = (title.trim() || result?.jobTitle || '').trim();
  const resolvedCompany = (company.trim() || result?.company || '').trim();
  const canSave = !!result && !!resolvedTitle && !!resolvedCompany && !saved && !addApplication.isPending;

  useEffect(() => {
    if (result || imported.length > 0) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result, imported]);

  function handleScored(job: ScoredJob): void {
    setImported([]);
    setTitle(job.title);
    setCompany(job.company);
    setDescription(job.description);
    setResult(job.result);
    setSaved(null);
    setSaveError(null);
    setShowInterviewModal(false);
    setInterviewScheduled(false);
    setStatus('DecidedToApply');
    setShowScoreModal(false);
  }

  function handleImported(results: ImportJobResult[]): void {
    setResult(null);
    setImported((prev) => [...prev, ...results]);
  }

  function handleSave(): void {
    if (!result || !resolvedTitle || !resolvedCompany) return;
    setSaveError(null);
    // Store the analysis without the raw Claude snapshots — those live in their
    // own Application columns, mirroring how the discovery path persists jobs.
    const {
      analystSnapshotInput,
      analystSnapshotOutput,
      evaluatorSnapshotInput,
      evaluatorSnapshotOutput,
      ...analysis
    } = result;
    addApplication.mutate(
      {
        jobTitle: resolvedTitle,
        company: resolvedCompany,
        status,
        jobDescription: description,
        matchScore: result.overallScore ?? null,
        matchVerdict: result.verdict,
        matchAnalysis: JSON.stringify(analysis),
        analystSnapshotInput: analystSnapshotInput ?? null,
        analystSnapshotOutput: analystSnapshotOutput ?? null,
        evaluatorSnapshotInput: evaluatorSnapshotInput ?? null,
        evaluatorSnapshotOutput: evaluatorSnapshotOutput ?? null,
        source: 'manual',
      },
      {
        onSuccess: (data) => setSaved(data as SavedRef),
        onError: (e) => setSaveError((e as Error).message),
      },
    );
  }

  function handleScoreAnother(): void {
    setTitle('');
    setCompany('');
    setDescription('');
    setResult(null);
    setImported([]);
    setSaved(null);
    setSaveError(null);
    setShowInterviewModal(false);
    setInterviewScheduled(false);
    setShowScoreModal(true);
  }

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1040px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

      <header className="mb-9 relative">
        <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
          <span>Score</span>
          <span className="hidden sm:block text-[var(--ed-accent)]">Manual · Paste &amp; Score</span>
        </div>
        <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">
          Score a <span className="italic font-medium text-[var(--ed-accent)]">Job</span>
        </h1>
        <p className="mt-3 text-[var(--ed-ink-soft)] text-[0.95rem] max-w-[560px] leading-[1.6]">
          See how well any job matches your profile — before you apply.
        </p>
        <div className="mt-5 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
      </header>

      {!result && imported.length === 0 && (
        <div className="border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 p-9 flex flex-col items-center text-center gap-4">
          <div className="w-11 h-11 rounded-lg bg-[var(--ed-accent)]/15 text-[var(--ed-accent)] flex items-center justify-center">
            <Link2 size={20} aria-hidden="true" />
          </div>
          <div>
            <p className="text-[16px] font-medium text-[var(--ed-ink)]">Paste a link or the description</p>
            <p className="mt-1 text-[0.85rem] text-[var(--ed-ink-faint)]">We&apos;ll score it against your profile in seconds.</p>
          </div>
          <button type="button" className={ED_PRIMARY} onClick={() => setShowScoreModal(true)}>
            Score a Job
          </button>
        </div>
      )}

      {showScoreModal && (
        <ScoreJobModal
          onClose={() => setShowScoreModal(false)}
          onScored={handleScored}
          onImported={handleImported}
        />
      )}

      <div ref={resultRef} />

      {imported.length > 0 && (
        <div className="border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--ed-ink-faint)]">
              Imported to Active
            </span>
            <button type="button" className={ED_GHOST} onClick={handleScoreAnother}>
              Score Another
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {imported.map((r) => (
              <div key={r.url} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-[0.9rem] text-[var(--ed-ink)]">
                  <Check size={15} className="shrink-0 text-[var(--ed-yes)]" aria-hidden="true" />
                  {r.title ?? 'Untitled role'}{r.company ? ` at ${r.company}` : ''}
                  {typeof r.score === 'number' && (
                    <span className="text-[var(--ed-ink-faint)]">— score {r.score}{r.verdict ? ` · ${r.verdict}` : ''}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <Link to="/active" className={`${ED_PRIMARY} inline-block mt-5`}>View in Active</Link>
        </div>
      )}

      {result && (
        <>
          <div className="flex items-center justify-between gap-4 mb-4">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--ed-ink-faint)]">
              {resolvedTitle && resolvedCompany ? `${resolvedTitle} · ${resolvedCompany}` : 'Result'}
            </span>
            <button type="button" className={ED_GHOST} onClick={handleScoreAnother}>
              Score Another
            </button>
          </div>

          <AnalysisCard matchAnalysisJson={JSON.stringify(result)} />

          <div className="border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 p-5 flex items-center justify-between gap-4 flex-wrap">
            {saved ? (
              <>
                <span className="text-[0.88rem] text-[var(--ed-yes)] font-semibold uppercase tracking-[0.06em]">
                  Saved.{interviewScheduled ? ' Interview scheduled.' : ''}
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {!interviewScheduled && (
                    <button type="button" className={ED_GHOST} onClick={() => setShowInterviewModal(true)}>
                      Schedule Interview
                    </button>
                  )}
                  <Link to={`/tracker/${saved.id}`} className={ED_PRIMARY}>View in Active</Link>
                </div>
              </>
            ) : (
              <>
                <div className="text-[0.85rem] text-[var(--ed-ink-soft)] leading-[1.5]">
                  {canSave
                    ? <>Save <span className="text-[var(--ed-ink)] font-semibold">{resolvedTitle}</span> at <span className="text-[var(--ed-ink)] font-semibold">{resolvedCompany}</span>.</>
                    : 'Missing a job title or company — reopen and add one to save it.'}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="ms-status" className="text-[var(--ed-ink-soft)]">Save as</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger id="ms-status" className="min-w-[180px]">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        {SAVE_STATUSES.map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <button type="button" className={ED_PRIMARY} onClick={handleSave} disabled={!canSave}>
                    {addApplication.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            )}
            {saveError && (
              <div className="w-full mt-1 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[0.88rem] border border-[var(--ed-no)]/30">{saveError}</div>
            )}
          </div>

          {saved && showInterviewModal && (
            <InterviewModal
              appId={saved.id}
              onClose={() => setShowInterviewModal(false)}
              onSaved={() => {
                setShowInterviewModal(false);
                setInterviewScheduled(true);
              }}
            />
          )}
        </>
      )}
      </div>
    </div>
  );
}
