import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Download, Sparkles, RefreshCw, ChevronLeft, ChevronRight, ExternalLink, Pencil } from 'lucide-react';
import { useApplicationDetail, usePack } from '../lib/queries';
import { useGeneratePack } from '../lib/mutations';
import { apiUrl } from '../lib/api';
import { hasRealJobUrl } from '../lib/format';
import { ResumePackEditModal } from '../components/ResumePackEditModal';

const ED_BTN = 'rounded-full border px-4 py-[0.55rem] text-[0.8rem] font-semibold tracking-[0.02em] transition-all disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-[0.4rem]';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;

// Floating circular page-nav button, overlaid on the embed itself — locked
// to the résumé page (absolute within the preview container), vertically
// centered on its right/left edge, like a carousel arrow.
function PageNavButton({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={direction === 'next' ? 'Next page' : 'Previous page'}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 ${direction === 'next' ? 'right-4' : 'left-4'} w-10 h-10 rounded-full bg-[var(--ed-paper)]/80 text-[var(--ed-ink)] flex items-center justify-center shadow-lg hover:bg-[var(--ed-accent)] hover:text-[var(--ed-paper)] transition-colors`}
    >
      {direction === 'next' ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
    </button>
  );
}

interface ApplicationSummary {
  jobTitle: string;
  company: string;
  jobUrl: string | null;
}

export default function ResumePackPage() {
  const { id } = useParams<{ id: string }>();
  const appId = id ?? '';
  const navigate = useNavigate();
  const detailQuery = useApplicationDetail(appId);
  const packQuery = usePack(appId, true);
  const generateMutation = useGeneratePack();
  const pack = packQuery.data;
  const app = (detailQuery.data as { application?: ApplicationSummary } | undefined)?.application;
  const [page, setPage] = useState(1);
  const [showEditModal, setShowEditModal] = useState(false);

  // Back to page 1 whenever a (re)generated pack loads — the previous pack's
  // page 3 isn't meaningful once the content underneath it has changed.
  useEffect(() => {
    setPage(1);
  }, [pack?.generatedAt]);

  function regenerate(): void {
    generateMutation.mutate(appId);
  }

  const pageCount = pack?.pageCount ?? null;
  const pageAspect = pack?.pageWidth && pack?.pageHeight ? `${pack.pageWidth} / ${pack.pageHeight}` : null;

  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="relative z-[1] max-w-[900px] mx-auto px-8 pt-12 pb-16 max-[640px]:px-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-[var(--ed-accent)] cursor-pointer text-[0.72rem] font-semibold uppercase tracking-[0.12em] mb-7 inline-flex items-center gap-[0.4rem] transition-all hover:-translate-x-[3px]"
        >
          &larr; Back
        </button>

        <header className="mb-9 pb-4 border-b border-[var(--ed-rule-strong)]">
          <div className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-[var(--ed-accent)] mb-2">Résumé Pack</div>
          <h1 className="ed-display font-black text-[clamp(1.7rem,4vw,2.6rem)] leading-[1.05] tracking-[-0.02em] text-[var(--ed-ink)]">
            {app ? `${app.jobTitle} — ${app.company}` : ' '}
          </h1>
        </header>

        {packQuery.isLoading && <p className="text-[var(--ed-ink-faint)] py-6 text-[0.88rem]">Loading&hellip;</p>}

        {!packQuery.isLoading && !pack && (
          <div className="border border-dashed border-[var(--ed-rule)] py-16 px-8 flex flex-col items-center gap-4 text-center">
            <p className="text-[var(--ed-ink-soft)] text-[0.88rem]">No résumé pack generated yet for this application.</p>
            <button type="button" className={ED_PRIMARY} onClick={regenerate} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? (
                <><RefreshCw size={14} className="animate-spin" /> Generating&hellip;</>
              ) : (
                <><Sparkles size={14} /> Generate Pack</>
              )}
            </button>
          </div>
        )}

        {pack && (
          <div className="flex flex-col gap-3">
            {/* Real generated PDF, not a plain-text summary. pointer-events-none:
                the URL's `page=N` only sets *initial* scroll position — Chrome's
                native viewer still lets wheel scroll drift onto neighboring
                pages afterward. The wrapper is sized to the PDF's real aspect
                ratio (from PdfPageCounter.GetFirstPageSize) so a fit-to-width
                page exactly fills it — otherwise the viewer's continuous-scroll
                layout bleeds the top of the next page into leftover space. The
                embed is oversized 20px on every side + clipped so Chrome's
                native scrollbars (it ignores `#scrollbar=0`) render outside the
                visible crop. */}
            <div
              className={`relative overflow-hidden w-full border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 ${pageAspect ? '' : 'h-[75vh] min-h-[560px]'}`}
              style={pageAspect ? { aspectRatio: pageAspect } : undefined}
            >
              <embed
                key={`${pack.generatedAt}-${page}`}
                src={`${apiUrl(`/applications/${appId}/pack/pdf`)}?inline=true#toolbar=0&view=${pageAspect ? 'FitH' : 'Fit'}&page=${page}`}
                type="application/pdf"
                className="w-[calc(100%+20px)] h-[calc(100%+20px)] block pointer-events-none"
              />
              {(pageCount ?? 1) > 1 && (
                <span className="absolute top-4 right-4 px-3 py-[0.35rem] rounded-full bg-[var(--ed-paper)]/80 text-[var(--ed-ink)] text-[0.7rem] font-semibold tabular-nums shadow-lg">
                  Page {page} of {pageCount}
                </span>
              )}
              {page > 1 && <PageNavButton direction="prev" onClick={() => setPage((p) => p - 1)} />}
              {pageCount !== null && page < pageCount && <PageNavButton direction="next" onClick={() => setPage((p) => p + 1)} />}
            </div>
            <p className="text-[0.72rem] text-[var(--ed-ink-faint)] tabular-nums">
              Generated {new Date(pack.generatedAt).toLocaleString()}
            </p>
          </div>
        )}

        {generateMutation.isError && (
          <p className="text-[var(--ed-no)] text-[0.85rem] mt-3">{(generateMutation.error as Error).message}</p>
        )}

        {pack && (
          <div className="flex flex-wrap gap-2 mt-6">
            <button type="button" className={ED_GHOST} onClick={regenerate} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? (
                <><RefreshCw size={14} className="animate-spin" /> Regenerating&hellip;</>
              ) : (
                <><Sparkles size={14} /> Regenerate</>
              )}
            </button>
            <button type="button" className={ED_GHOST} onClick={() => setShowEditModal(true)}>
              <Pencil size={14} /> Edit Manually
            </button>
            {app?.jobUrl && hasRealJobUrl(app.jobUrl) && (
              <a href={app.jobUrl} target="_blank" rel="noopener noreferrer" className={ED_GHOST}>
                <ExternalLink size={14} /> View Job
              </a>
            )}
            <a href={apiUrl(`/applications/${appId}/pack/pdf`)} download className={ED_PRIMARY}>
              <Download size={14} /> Download PDF
            </a>
          </div>
        )}
      </div>

      {pack && showEditModal && (
        <ResumePackEditModal appId={appId} pack={pack} onClose={() => setShowEditModal(false)} />
      )}
    </div>
  );
}
