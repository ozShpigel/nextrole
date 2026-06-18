import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useScoreJob, useAddApplication } from '../lib/mutations';
import type { MatchResponse } from '../lib/types';
import AnalysisCard from '../components/AnalysisCard';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const MIN_DESCRIPTION = 50;

const ED_BTN = 'rounded-none border px-4 py-[0.55rem] text-[0.7rem] font-semibold uppercase tracking-[0.1em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;

interface SavedRef {
  id: string;
}

export default function ManualScorePage() {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');

  const [result, setResult] = useState<MatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedRef | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const scoreJob = useScoreJob();
  const addApplication = useAddApplication();

  const trimmedDescription = description.trim();
  const canScore = trimmedDescription.length >= MIN_DESCRIPTION && !scoreJob.isPending;

  // The save needs a job title + company. Prefer what the user typed; fall back
  // to what the analyst extracted from the description.
  const resolvedTitle = (title.trim() || result?.jobTitle || '').trim();
  const resolvedCompany = (company.trim() || result?.company || '').trim();
  const canSave = !!result && !!resolvedTitle && !!resolvedCompany && !saved && !addApplication.isPending;

  function handleScore(): void {
    if (!canScore) return;
    setError(null);
    setSaveError(null);
    setSaved(null);
    setResult(null);
    scoreJob.mutate(
      {
        jobDescription: trimmedDescription,
        title: title.trim() || undefined,
        company: company.trim() || undefined,
        location: location.trim() || undefined,
      },
      {
        onSuccess: (data) => setResult(data),
        onError: (e) => setError((e as Error).message),
      },
    );
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
        status: 'DecidedToApply',
        jobDescription: trimmedDescription,
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

  function handleReset(): void {
    setTitle('');
    setCompany('');
    setLocation('');
    setDescription('');
    setResult(null);
    setError(null);
    setSaved(null);
    setSaveError(null);
  }

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1040px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

      <header className="mb-9 relative">
        <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
          <span>Vol. III · Score</span>
          <span className="hidden sm:block text-[var(--ed-accent)]">Manual · Paste &amp; Score</span>
        </div>
        <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">
          Score a <span className="italic font-medium text-[var(--ed-accent)]">Job</span>
        </h1>
        <p className="mt-3 text-[var(--ed-ink-soft)] text-[0.95rem] max-w-[560px] leading-[1.6]">
          Paste a job description to score it against your profile — the same AI analysis as discovery, on demand. Save the ones worth pursuing straight to your tracker.
        </p>
        <div className="mt-5 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
      </header>

      <div className="border border-[var(--ed-rule)] p-6 mb-9">
        <div className="grid grid-cols-2 gap-4 mb-4 max-[640px]:grid-cols-1">
          <div className="flex flex-col gap-[0.4rem]">
            <Label htmlFor="ms-title">Job Title</Label>
            <Input id="ms-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer" />
          </div>
          <div className="flex flex-col gap-[0.4rem]">
            <Label htmlFor="ms-company">Company</Label>
            <Input id="ms-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme Inc." />
          </div>
        </div>
        <div className="flex flex-col gap-[0.4rem] mb-4">
          <Label htmlFor="ms-location">Location <span className="text-[var(--ed-ink-faint)] font-normal">(optional)</span></Label>
          <Input id="ms-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Tel Aviv / Remote" />
        </div>
        <div className="flex flex-col gap-[0.4rem]">
          <Label htmlFor="ms-description">Job Description</Label>
          <Textarea
            id="ms-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Paste the full job description here…"
            dir="auto"
            className="min-h-[280px] resize-y font-sans text-[0.88rem] leading-[1.6]"
          />
          <div className="flex items-center justify-between text-[0.72rem] text-[var(--ed-ink-faint)] tracking-[0.02em]">
            <span>{title.trim() || company.trim() ? '' : 'Title and company are optional — the analyst will extract them if left blank.'}</span>
            <span className="tabular-nums">{trimmedDescription.length.toLocaleString()} chars{trimmedDescription.length > 0 && trimmedDescription.length < MIN_DESCRIPTION ? ` · need ${MIN_DESCRIPTION}+` : ''}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5">
          <button type="button" className={ED_PRIMARY} onClick={handleScore} disabled={!canScore}>
            {scoreJob.isPending ? 'Scoring…' : 'Score Job'}
          </button>
          {(result || description || title || company || location) && (
            <button type="button" className={ED_GHOST} onClick={handleReset} disabled={scoreJob.isPending}>
              Clear
            </button>
          )}
          {scoreJob.isPending && (
            <span className="text-[0.8rem] text-[var(--ed-ink-faint)]">Running analyst + evaluator — this can take up to a minute.</span>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[0.88rem] border border-[var(--ed-no)]/30">{error}</div>
        )}
      </div>

      {result && (
        <>
          <AnalysisCard matchAnalysisJson={JSON.stringify(result)} />

          <div className="border border-[var(--ed-rule)] p-5 flex items-center justify-between gap-4 flex-wrap">
            {saved ? (
              <>
                <span className="text-[0.88rem] text-[var(--ed-yes)] font-semibold uppercase tracking-[0.06em]">Saved to your tracker.</span>
                <Link to={`/tracker/${saved.id}`} className={ED_PRIMARY}>View in Tracker</Link>
              </>
            ) : (
              <>
                <div className="text-[0.85rem] text-[var(--ed-ink-soft)] leading-[1.5]">
                  {canSave
                    ? <>Save <span className="text-[var(--ed-ink)] font-semibold">{resolvedTitle}</span> at <span className="text-[var(--ed-ink)] font-semibold">{resolvedCompany}</span> to your tracker.</>
                    : 'Add a job title and company above to save this to your tracker.'}
                </div>
                <button type="button" className={ED_PRIMARY} onClick={handleSave} disabled={!canSave}>
                  {addApplication.isPending ? 'Saving…' : 'Save to Tracker'}
                </button>
              </>
            )}
            {saveError && (
              <div className="w-full mt-1 p-3 bg-[var(--ed-no)]/10 text-[var(--ed-no)] text-[0.88rem] border border-[var(--ed-no)]/30">{saveError}</div>
            )}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
