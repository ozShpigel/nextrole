import { Download, Sparkles, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { usePack } from '../lib/queries';
import { useGeneratePack } from '../lib/mutations';
import { apiUrl } from '../lib/api';

interface ResumePackModalProps {
  appId: string;
  jobTitle: string;
  company: string;
  open: boolean;
  onClose: () => void;
}

// Portal-rendered (shadcn Dialog mounts outside .editorial), so neutral
// tokens throughout — never --ed-* (design-system.md portal caveat).
export function ResumePackModal({ appId, jobTitle, company, open, onClose }: ResumePackModalProps) {
  const packQuery = usePack(appId, open);
  const generateMutation = useGeneratePack();
  const pack = packQuery.data;

  function regenerate(): void {
    generateMutation.mutate(appId);
  }

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Résumé pack</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{jobTitle} — {company}</p>

        {packQuery.isLoading && <p className="text-sm text-muted-foreground py-6">Loading…</p>}

        {pack && (
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Summary</h3>
              <p className="text-sm" dir="auto">{pack.tailoredSummary}</p>
            </div>

            {pack.experience.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Experience</h3>
                <div className="flex flex-col gap-3">
                  {pack.experience.map((role, i) => (
                    <div key={i}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium" dir="auto">{role.title}{role.company ? ` · ${role.company}` : ''}</span>
                        {role.dates && <span className="text-xs text-muted-foreground shrink-0">{role.dates}</span>}
                      </div>
                      <ul className="mt-1 pl-4 list-disc text-sm text-muted-foreground">
                        {role.highlights.map((h, j) => <li key={j} dir="auto">{h}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pack.highlightedSkills.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Skills</h3>
                <p className="text-sm text-muted-foreground">{pack.highlightedSkills.join('  ·  ')}</p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Generated {new Date(pack.generatedAt).toLocaleString()}
            </p>
          </div>
        )}

        {generateMutation.isError && (
          <p className="text-sm text-destructive">{(generateMutation.error as Error).message}</p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={regenerate} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? (
              <><RefreshCw size={14} className="animate-spin" /> Regenerating…</>
            ) : (
              <><Sparkles size={14} /> Regenerate</>
            )}
          </Button>
          {pack && (
            <a href={apiUrl(`/applications/${appId}/pack/pdf`)} download>
              <Button>
                <Download size={14} /> Download PDF
              </Button>
            </a>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
