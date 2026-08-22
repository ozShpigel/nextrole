import { useState } from 'react';
import { Link2, ChevronDown, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useImportJobs, useScoreJob, useAddApplication } from '../lib/mutations';
import type { MatchResponse } from '../lib/types';

const MAX_URLS = 5;
const MIN_DESCRIPTION = 50;

interface ImportJobModalProps {
  onClose: () => void;
}

export function ImportJobModal({ onClose }: ImportJobModalProps) {
  const [urlsText, setUrlsText] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualCompany, setManualCompany] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ url: string; error: string | null }[]>([]);

  const importJobs = useImportJobs();
  const scoreJob = useScoreJob();
  const addApplication = useAddApplication();

  const urls = urlsText.split('\n').map((u) => u.trim()).filter(Boolean);
  const tooMany = urls.length > MAX_URLS;
  const canImport = urls.length > 0 && !tooMany && !importJobs.isPending;

  const manualPending = scoreJob.isPending || addApplication.isPending;
  const trimmedManualDescription = manualDescription.trim();

  function handleImportUrls(): void {
    if (!canImport) return;
    setError(null);
    setFailures([]);
    importJobs.mutate(urls, {
      onSuccess: (data) => {
        const failed = data.results.filter((r) => r.status === 'failed');
        if (failed.length === 0) {
          onClose();
          return;
        }
        // Partial success: keep the modal open, show what failed, clear the
        // rest so re-submitting doesn't re-import the ones that already saved.
        setUrlsText(failed.map((f) => f.url).join('\n'));
        setFailures(failed.map((f) => ({ url: f.url, error: f.error })));
      },
      onError: (e) => setError((e as Error).message),
    });
  }

  async function handleImportManual(): Promise<void> {
    if (trimmedManualDescription.length < MIN_DESCRIPTION || manualPending) return;
    setError(null);
    try {
      const result = (await scoreJob.mutateAsync({
        jobDescription: trimmedManualDescription,
        title: manualTitle.trim() || undefined,
        company: manualCompany.trim() || undefined,
      })) as MatchResponse;

      const resolvedTitle = (manualTitle.trim() || result.jobTitle || '').trim();
      const resolvedCompany = (manualCompany.trim() || result.company || '').trim();
      if (!resolvedTitle || !resolvedCompany) {
        setError("Couldn't tell the title/company apart from the description — add them above and try again.");
        return;
      }

      const {
        analystSnapshotInput, analystSnapshotOutput,
        evaluatorSnapshotInput, evaluatorSnapshotOutput,
        ...analysis
      } = result;
      await addApplication.mutateAsync({
        jobTitle: resolvedTitle,
        company: resolvedCompany,
        status: 'DecidedToApply',
        jobDescription: trimmedManualDescription,
        matchScore: result.overallScore ?? null,
        matchVerdict: result.verdict,
        matchAnalysis: JSON.stringify(analysis),
        analystSnapshotInput: analystSnapshotInput ?? null,
        analystSnapshotOutput: analystSnapshotOutput ?? null,
        evaluatorSnapshotInput: evaluatorSnapshotInput ?? null,
        evaluatorSnapshotOutput: evaluatorSnapshotOutput ?? null,
        source: 'manual',
      });
      onClose();
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
              <DialogTitle>Import a job</DialogTitle>
              <DialogDescription>
                We&apos;ll store the job privately for you and let you generate the application.
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
          <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
              Or paste the description
              <ChevronDown size={15} className="transition-transform group-open:rotate-180" aria-hidden="true" />
            </span>
            {urls.length > 0 && !tooMany && (
              <span className="text-xs text-muted-foreground">{urls.length} link{urls.length === 1 ? '' : 's'} detected</span>
            )}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ij-title">Job Title</Label>
                <Input id="ij-title" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ij-company">Company</Label>
                <Input id="ij-company" value={manualCompany} onChange={(e) => setManualCompany(e.target.value)} placeholder="e.g. Acme Inc." />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ij-description">Job Description</Label>
              <Textarea
                id="ij-description"
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
              disabled={trimmedManualDescription.length < MIN_DESCRIPTION || manualPending}
              onClick={handleImportManual}
            >
              {manualPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
              {scoreJob.isPending ? 'Scoring…' : addApplication.isPending ? 'Saving…' : 'Score & Import'}
            </Button>
          </div>
        </details>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={handleImportUrls} disabled={!canImport}>
            {importJobs.isPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {importJobs.isPending ? 'Importing…' : 'Import job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
