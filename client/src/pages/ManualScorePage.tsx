import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useScoreJob, useAddApplication } from '../lib/mutations';
import type { MatchResponse } from '../lib/types';
import AnalysisCard from '../components/AnalysisCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const MIN_DESCRIPTION = 50;

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
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      {/* Atmospheric glows */}
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />

      <header className="mb-8 relative">
        <Badge variant="outline" className="font-mono text-[0.65rem] tracking-[0.26em] uppercase text-muted-foreground font-medium border-border bg-muted/50 mb-[1.2rem]">Manual · Paste & Score</Badge>
        <h1 className="font-serif text-[clamp(2rem,4vw,2.7rem)] font-bold text-foreground leading-[1.1] mb-[0.65rem] tracking-[-0.01em]">Score a Job</h1>
        <p className="text-muted-foreground text-[0.95rem] max-w-[560px] leading-[1.6]">
          Paste a job description to score it against your profile — the same AI analysis as discovery, on demand. Save the ones worth pursuing straight to your tracker.
        </p>
        <Separator className="mt-[1.6rem]" />
      </header>

      <Card className="p-6 mb-6">
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
          <Label htmlFor="ms-location">Location <span className="text-muted-foreground font-normal">(optional)</span></Label>
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
          <div className="flex items-center justify-between text-[0.72rem] text-muted-foreground tracking-[0.02em]">
            <span>{title.trim() || company.trim() ? '' : 'Title and company are optional — the analyst will extract them if left blank.'}</span>
            <span>{trimmedDescription.length.toLocaleString()} chars{trimmedDescription.length > 0 && trimmedDescription.length < MIN_DESCRIPTION ? ` · need ${MIN_DESCRIPTION}+` : ''}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-5">
          <Button onClick={handleScore} disabled={!canScore}>
            {scoreJob.isPending ? 'Scoring…' : 'Score Job'}
          </Button>
          {(result || description || title || company || location) && (
            <Button variant="outline" onClick={handleReset} disabled={scoreJob.isPending}>
              Clear
            </Button>
          )}
          {scoreJob.isPending && (
            <span className="text-[0.8rem] text-muted-foreground">Running analyst + evaluator — this can take up to a minute.</span>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-destructive/10 text-destructive text-[0.88rem] rounded border border-destructive/20">{error}</div>
        )}
      </Card>

      {result && (
        <>
          <AnalysisCard matchAnalysisJson={JSON.stringify(result)} />

          <Card className="p-5 flex items-center justify-between gap-4 flex-wrap">
            {saved ? (
              <>
                <span className="text-[0.88rem] text-emerald-600 font-medium">Saved to your tracker.</span>
                <Button asChild>
                  <Link to={`/tracker/${saved.id}`}>View in Tracker</Link>
                </Button>
              </>
            ) : (
              <>
                <div className="text-[0.85rem] text-muted-foreground leading-[1.5]">
                  {canSave
                    ? <>Save <span className="text-foreground font-medium">{resolvedTitle}</span> at <span className="text-foreground font-medium">{resolvedCompany}</span> to your tracker.</>
                    : 'Add a job title and company above to save this to your tracker.'}
                </div>
                <Button onClick={handleSave} disabled={!canSave}>
                  {addApplication.isPending ? 'Saving…' : 'Save to Tracker'}
                </Button>
              </>
            )}
            {saveError && (
              <div className="w-full mt-1 p-3 bg-destructive/10 text-destructive text-[0.88rem] rounded border border-destructive/20">{saveError}</div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
