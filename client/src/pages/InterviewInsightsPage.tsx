import { RefreshCw, Sparkles } from 'lucide-react';
import { useInterviewRetros, useInterviewInsight } from '../lib/queries';
import { useSynthesizeInsights } from '../lib/mutations';
import type { InterviewRetroListItem, InterviewInsightResponse } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
import { formatDateTime } from '../lib/format';

const ED_BTN = 'rounded-full border px-3.5 py-[0.5rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;

function ratingColor(n: number): string {
  if (n >= 4) return 'var(--ed-yes)';
  if (n >= 3) return 'var(--ed-gold)';
  return 'var(--ed-no)';
}

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

function RetroCard({ item }: { item: InterviewRetroListItem }) {
  const { interview, company, jobTitle } = item;
  const rating = interview.retroRating ?? null;
  return (
    <div className="border border-[var(--ed-rule)] p-[1rem_1.25rem] bg-[var(--ed-panel)]">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="text-[0.88rem] font-semibold text-[var(--ed-ink)]">
            {interview.type}{company ? ` · ${company}` : ''}{jobTitle ? ` — ${jobTitle}` : ''}
          </p>
          <p className="text-[0.74rem] text-[var(--ed-ink-faint)] mt-0.5">{formatDateTime(interview.scheduledAt)}</p>
        </div>
        {rating !== null && (
          <span
            className="shrink-0 ed-display text-[1.1rem] font-bold tabular-nums"
            style={{ color: ratingColor(rating) }}
          >
            {rating}<span className="text-[0.72rem] text-[var(--ed-ink-faint)] font-normal"> / 5</span>
          </span>
        )}
      </div>
      {interview.retroWentWell && (
        <p dir="auto" className="text-[0.84rem] leading-[1.6] text-[var(--ed-ink)] mt-2">
          <span className="text-[var(--ed-ink-faint)]">Went well: </span>{interview.retroWentWell}
        </p>
      )}
      {interview.retroToImprove && (
        <p dir="auto" className="text-[0.84rem] leading-[1.6] text-[var(--ed-ink)] mt-1">
          <span className="text-[var(--ed-ink-faint)]">To improve: </span>{interview.retroToImprove}
        </p>
      )}
      {interview.retroCategories && interview.retroCategories.length > 0 && (
        <div className="flex items-center gap-[0.35rem] flex-wrap mt-2">
          {interview.retroCategories.map((c) => (
            <span key={c} className="rounded-full border border-[var(--ed-rule)] px-2 py-[0.15rem] text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink-faint)]">
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Pure observation feed — a single standing summary, no rubric shape and no
// adopt action. Decoupled from interview-prep by design (see docs/interview-prep.md).
function InsightPanel({ data, onGenerate, generating, failed }: {
  data: InterviewInsightResponse;
  onGenerate: () => void;
  generating: boolean;
  failed: boolean;
}) {
  const { insight, newRetroCount, insufficientData } = data;
  const buttonLabel = insight === null ? 'Generate insight' : 'Refresh';

  return (
    <div>
      {insight === null ? (
        <p className="text-[0.86rem] text-[var(--ed-ink-faint)] italic mb-4">
          {insufficientData
            ? 'Not enough retros yet to generate an insight — add a few more and try again.'
            : 'No insight yet.'}
        </p>
      ) : (
        <div className="border border-[var(--ed-rule)] p-[1rem_1.25rem] bg-[var(--ed-panel)] mb-4">
          <p dir="auto" className="text-[0.9rem] leading-[1.8] text-[var(--ed-ink)] whitespace-pre-wrap">{insight.summary}</p>
          <p className="text-[0.72rem] text-[var(--ed-ink-faint)] mt-3 pt-2 border-t border-dashed border-[var(--ed-rule)]">
            Generated from {insight.retroCount} retro{insight.retroCount === 1 ? '' : 's'} · {formatDateTime(insight.generatedAt)}
          </p>
          {newRetroCount > 0 && (
            <p className="text-[0.72rem] text-[var(--ed-gold)] mt-1">
              {newRetroCount} new retro{newRetroCount === 1 ? '' : 's'} since this insight — refresh to include {newRetroCount === 1 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        className={`${ED_PRIMARY} inline-flex items-center gap-[0.45rem]`}
        disabled={generating || insufficientData}
        onClick={onGenerate}
      >
        {generating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {buttonLabel}
      </button>
      {failed && <p className="text-[0.8rem] text-[var(--ed-no)] mt-2">Could not generate the insight</p>}
    </div>
  );
}

export default function InterviewInsightsPage() {
  const { data: retros, isLoading: retrosLoading } = useInterviewRetros();
  const { data: insightData, isLoading: insightLoading } = useInterviewInsight();
  const synthesize = useSynthesizeInsights();

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
        <header className="mb-9">
          <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
            <span>Interview Insights</span>
            <span className="hidden sm:block text-[var(--ed-accent)]">Learn from every interview</span>
          </div>
          <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">
            Interview <span className="italic font-medium text-[var(--ed-accent)]">Insights</span>
          </h1>
          <p className="mt-3 max-w-[600px] text-[0.95rem] leading-[1.6] text-[var(--ed-ink-soft)]">
            Every completed interview across every application, with the retro you wrote right after — and a standing summary of what keeps coming up.
          </p>
        </header>

        <section className="mb-16">
          <SectionHeader num="01" name="Retro log" desc="Most recent completed interview first." />
          {retrosLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-[90px] w-full" />
              <Skeleton className="h-[90px] w-full" />
            </div>
          ) : !retros || retros.length === 0 ? (
            <p className="text-[0.86rem] text-[var(--ed-ink-faint)] italic">
              No retros yet — mark an interview Completed on its application to capture one.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {retros.map((item) => (
                <RetroCard key={item.interview.id} item={item} />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHeader num="02" name="Insight" desc="Claude reads every retro fresh each time and writes a standing summary of what keeps coming up — it's regenerated on request, never a summary of its own prior output." />
          {insightLoading ? (
            <Skeleton className="h-[140px] w-full" />
          ) : insightData ? (
            <InsightPanel
              data={insightData}
              onGenerate={() => synthesize.mutate()}
              generating={synthesize.isPending}
              failed={synthesize.isError}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
