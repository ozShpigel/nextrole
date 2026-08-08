import { useEffect, useState } from 'react';
import { Download, Sparkles, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
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

// Floating circular page-nav button, overlaid on the embed itself (not a
// separate bar below it) — matches the single floating chevron pattern from
// the reference, rather than Settings' page's "Page X of Y" bar.
function PageNavButton({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={direction === 'next' ? 'Next page' : 'Previous page'}
      onClick={onClick}
      className={`absolute bottom-4 ${direction === 'next' ? 'right-4' : 'left-4'} w-9 h-9 rounded-full bg-foreground/70 text-background flex items-center justify-center shadow-md hover:bg-foreground/85 transition-colors`}
    >
      {direction === 'next' ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
    </button>
  );
}

// Portal-rendered (shadcn Dialog mounts outside .editorial), so neutral
// tokens throughout — never --ed-* (design-system.md portal caveat).
export function ResumePackModal({ appId, jobTitle, company, open, onClose }: ResumePackModalProps) {
  const packQuery = usePack(appId, open);
  const generateMutation = useGeneratePack();
  const pack = packQuery.data;
  const [page, setPage] = useState(1);

  // Back to page 1 whenever a (re)generated pack loads — the previous pack's
  // page 3 isn't meaningful once the content underneath it has changed.
  useEffect(() => {
    setPage(1);
  }, [pack?.generatedAt]);

  function regenerate(): void {
    generateMutation.mutate(appId);
  }

  const pageCount = pack?.pageCount ?? null;

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle>Résumé pack</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{jobTitle} — {company}</p>

        {packQuery.isLoading && <p className="text-sm text-muted-foreground py-6">Loading…</p>}

        {pack && (
          <div className="flex flex-col gap-2">
            {/* Same PDF-embed pattern as the Profile tab's résumé preview
                (SettingsPage.tsx) — the actual generated document, not a
                plain-text summary of its contents. */}
            <div className="relative bg-muted/40 border rounded-md overflow-hidden">
              <embed
                key={`${pack.generatedAt}-${page}`}
                src={`${apiUrl(`/applications/${appId}/pack/pdf`)}?inline=true#toolbar=0&view=FitH&page=${page}`}
                type="application/pdf"
                className="w-full h-[75vh] min-h-[560px] block"
              />
              {page > 1 && <PageNavButton direction="prev" onClick={() => setPage((p) => p - 1)} />}
              {pageCount !== null && page < pageCount && <PageNavButton direction="next" onClick={() => setPage((p) => p + 1)} />}
            </div>
            <p className="text-xs text-muted-foreground">
              Generated {new Date(pack.generatedAt).toLocaleString()}{pageCount ? ` — page ${page} of ${pageCount}` : ''}
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
