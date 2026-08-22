import { useState } from 'react';
import { Link2, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useImportJobs, useScoreJob } from '../lib/mutations';
import type { MatchResponse, ImportJobResult } from '../lib/types';

const MAX_URLS = 5;
const MIN_DESCRIPTION = 50;

export interface ScoredJob {
  result: MatchResponse;
  title: string;
  company: string;
  location: string;
  description: string;
}

interface ScoreJobModalProps {
  onClose: () => void;
  onScored: (job: ScoredJob) => void;
  onImported: (results: ImportJobResult[]) => void;
}

// Same shape as ImportJobModal (URL import + collapsible paste-description),
// but the manual path only scores — it never auto-saves. /score's whole point
// is to let the user see the breakdown and decide, so saving stays a separate,
// deliberate step on the page after this modal closes.
export function ScoreJobModal({ onClose, onScored, onImported }: ScoreJobModalProps) {
  const [urlsText, setUrlsText] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualCompany, setManualCompany] = useState('');
  const [manualLocation, setManualLocation] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ url: string; error: string | null }[]>([]);

  const importJobs = useImportJobs();
  const scoreJob = useScoreJob();

  const urls = urlsText.split('\n').map((u) => u.trim()).filter(Boolean);
  const tooMany = urls.length > MAX_URLS;
  const canImport = urls.length > 0 && !tooMany && !importJobs.isPending;

  const trimmedManualDescription = manualDescription.trim();
  const canScore = trimmedManualDescription.length >= MIN_DESCRIPTION && !scoreJob.isPending;

  function handleImportUrls(): void {
    if (!canImport) return;
    setError(null);
    setFailures([]);
    importJobs.mutate(urls, {
      onSuccess: (data: { results: ImportJobResult[] }) => {
        const failed = data.results.filter((r) => r.status === 'failed');
        const saved = data.results.filter((r) => r.status === 'saved');
        if (saved.length > 0) onImported(saved);
        if (failed.length === 0) {
          onClose();
          return;
        }
        setUrlsText(failed.map((f) => f.url).join('\n'));
        setFailures(failed.map((f) => ({ url: f.url, error: f.error })));
      },
      onError: (e) => setError((e as Error).message),
    });
  }

  async function handleScore(): Promise<void> {
    if (!canScore) return;
    setError(null);
    try {
      const result = await scoreJob.mutateAsync({
        jobDescription: trimmedManualDescription,
        title: manualTitle.trim() || undefined,
        company: manualCompany.trim() || undefined,
        location: manualLocation.trim() || undefined,
      });
      onScored({
        result,
        title: manualTitle.trim(),
        company: manualCompany.trim(),
        location: manualLocation.trim(),
        description: trimmedManualDescription,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <Link2 size={17} aria-hidden="true" />
            </div>
            <div>
              <DialogTitle>Score a job</DialogTitle>
              <DialogDescription>
                Paste a link or the description — we&apos;ll score it against your profile.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Textarea
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
          placeholder={'Paste job URL\nAdd more on new lines to import several at once'}
          dir="auto"
          className="min-h-[110px] resize-y"
        />
        {tooMany && (
          <p className="text-sm text-destructive -mt-2">At most {MAX_URLS} URLs at once — remove {urls.length - MAX_URLS} to continue.</p>
        )}

        {failures.length > 0 && (
          <div className="text-sm text-destructive space-y-1 -mt-2">
            {failures.map((f) => <p key={f.url} className="truncate">{f.url}: {f.error}</p>)}
          </div>
        )}

        <details className="group" open={showManual} onToggle={(e) => setShowManual((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer list-none inline-flex items-center gap-1 text-sm font-medium text-primary">
            Or paste the description
            <ChevronDown size={15} className="transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sj-title">Job Title</Label>
                <Input id="sj-title" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sj-company">Company</Label>
                <Input id="sj-company" value={manualCompany} onChange={(e) => setManualCompany(e.target.value)} placeholder="e.g. Acme Inc." />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sj-location">Location <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="sj-location" value={manualLocation} onChange={(e) => setManualLocation(e.target.value)} placeholder="e.g. Tel Aviv / Remote" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sj-description">Job Description</Label>
              <Textarea
                id="sj-description"
                value={manualDescription}
                onChange={(e) => setManualDescription(e.target.value)}
                placeholder="Paste the full job description here…"
                dir="auto"
                className="min-h-[160px] resize-y"
              />
              <span className="text-xs text-muted-foreground tabular-nums self-end">
                {trimmedManualDescription.length.toLocaleString()} chars{trimmedManualDescription.length > 0 && trimmedManualDescription.length < MIN_DESCRIPTION ? ` · need ${MIN_DESCRIPTION}+` : ''}
              </span>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="self-start"
              disabled={!canScore}
              onClick={handleScore}
            >
              {scoreJob.isPending ? 'Scoring…' : 'Score Job'}
            </Button>
          </div>
        </details>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={handleImportUrls} disabled={!canImport}>
            {importJobs.isPending ? 'Importing…' : 'Import Job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
