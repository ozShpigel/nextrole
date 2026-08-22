import { useState } from 'react';
import { VERDICT_LABELS } from '../lib/scoring';

// Dimension sub-score tint — a plain percentage split, used only where there's
// no verdict of its own to key off (the three breakdown components below).
export function edScoreColor(score: number | null | undefined, max?: number | null): string {
  if (score == null) return 'var(--ed-ink-faint)';
  const pct = max != null && max > 0 ? score / max : score / 100;
  if (pct >= 0.6) return 'var(--ed-yes)';
  if (pct >= 0.4) return 'var(--ed-gold)';
  return 'var(--ed-no)';
}

// The overall match score's color always comes from its verdict, never from
// a raw percentage split — VerdictBands (85/68/50/25) don't land on a flat
// 60/40 line, so a score-percentage heuristic can color a MAYBE score green.
// Keying off the verdict the server already computed guarantees the number
// and the label it sits next to never disagree.
export function edVerdictColor(verdict: string | null | undefined): string {
  switch (verdict?.replace(/ /g, '_')) {
    case 'STRONG_YES':
    case 'YES': return 'var(--ed-yes)';
    case 'MAYBE': return 'var(--ed-gold)';
    case 'NO':
    case 'STRONG_NO': return 'var(--ed-no)';
    default: return 'var(--ed-ink-faint)';
  }
}

// Hero score — 40px/500, colored by band; the strongest element on the card.
// A dimension sub-score (smaller, no maxScore caption) uses the same helper
// at a quieter size so it reads as a component of the same score, not a
// second competing metric.
function ScoreNumber({ score, maxScore, hero, color }: { score: number | null | undefined; maxScore: number; hero?: boolean; color: string }) {
  if (hero) {
    return (
      <div className="flex items-baseline gap-1 shrink-0">
        <span className="text-[40px] font-medium leading-none tabular-nums" style={{ color }}>{score ?? '—'}</span>
        <span className="text-[13px] text-[var(--ed-ink-faint)]">/ {maxScore}</span>
      </div>
    );
  }
  return <span className="text-[16px] font-medium tabular-nums" style={{ color }}>{score ?? '—'}<span className="text-[13px] text-[var(--ed-ink-faint)] font-normal"> / {maxScore}</span></span>;
}

interface DimensionDef {
  key: string;
  label: string;
  posLabel: string;
  negLabel: string;
  posKey: string;
  negKey: string;
}

const DIMS: DimensionDef[] = [
  { key: 'technicalFit', label: 'Technical', posLabel: 'Strengths', negLabel: 'Gaps', posKey: 'strengths', negKey: 'gaps' },
  { key: 'engineeringExecutionFit', label: 'Execution', posLabel: 'Strengths', negLabel: 'Concerns', posKey: 'strengths', negKey: 'concerns' },
  { key: 'sustainabilityPaceFit', label: 'Sustainability', posLabel: 'Positive Signals', negLabel: 'Concerns', posKey: 'positiveSignals', negKey: 'concerns' },
];

interface DimensionData {
  score: number;
  maxScore: number;
  [key: string]: unknown;
}

interface Recommendation {
  shouldApply: boolean;
  keyReasons?: string[];
  questionsToAsk?: string[];
  greenFlags?: string[];
  redFlags?: string[];
}

interface SignalAnalysis {
  greenSignals?: string[];
  redSignals?: string[];
  summary?: string;
}

interface MatchAnalysis {
  overallScore: number;
  verdict: string;
  breakdown?: Record<string, DimensionData>;
  recommendation?: Recommendation;
  companyNewsAnalysis?: SignalAnalysis;
  employeeReviewsAnalysis?: SignalAnalysis;
  honestAssessment?: string;
  hardBlockers?: string[];
  mustClarify?: string[];
  stackedGaps?: string[];
}

interface AnalysisCardProps {
  // Accepts a raw JSON string, an already-parsed MatchAnalysis, or (from the
  // Matches page) the API's own MatchResponse shape — a structurally
  // compatible but more loosely-typed object (nullable overallScore,
  // untyped breakdown/recommendation). Parsing below is already defensive
  // (every section checks its own fields before rendering), so a wider
  // input type here doesn't weaken anything at runtime.
  matchAnalysisJson: string | MatchAnalysis | Record<string, unknown> | null | undefined;
}

const SUBLABEL = 'block text-[13px] text-[var(--ed-ink-faint)] tracking-[0.02em] font-medium mb-[0.4rem]';

// +/- signal footnotes — calmer than filled chips for the long sentence-
// length flags the evaluator returns. Neutral ink throughout: the +/- glyph
// itself carries the valence, not a color, so it never competes with the
// score for attention.
// dir="auto" (not a hardcoded "rtl"): this renders both recommendation.
// greenFlags/redFlags (English pre-Add, Hebrew after Add generates the full
// rewrite) and companyNewsAnalysis/employeeReviewsAnalysis (always Hebrew,
// only ever present after Add) — the per-item language isn't fixed, so let
// the browser detect each line's actual direction instead of assuming RTL.
function SignalRows({ green = [], red = [] }: { green?: string[]; red?: string[] }) {
  return (
    <div className="flex flex-col gap-[0.45rem]" dir="auto">
      {green.map((s, i) => (
        <div key={`g${i}`} className="flex items-start gap-[0.55rem]">
          <span className="text-[16px] font-medium leading-[1.2] text-[var(--ed-ink-faint)] shrink-0" aria-hidden="true">+</span>
          <span className="text-[16px] text-[var(--ed-ink)] leading-[1.55]" dir="auto">{s}</span>
        </div>
      ))}
      {red.map((s, i) => (
        <div key={`r${i}`} className="flex items-start gap-[0.55rem]">
          <span className="text-[16px] font-medium leading-[1.2] text-[var(--ed-ink-faint)] shrink-0" aria-hidden="true">–</span>
          <span className="text-[16px] text-[var(--ed-ink)] leading-[1.55]" dir="auto">{s}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalysisCard({ matchAnalysisJson }: AnalysisCardProps) {
  const [open, setOpen] = useState(true);
  const [activeDim, setActiveDim] = useState<string | null>(null);

  if (!matchAnalysisJson) return null;
  let a: MatchAnalysis;
  try { a = typeof matchAnalysisJson === 'string' ? JSON.parse(matchAnalysisJson) : (matchAnalysisJson as MatchAnalysis); } catch { return null; }

  const b = a.breakdown;
  const rec = a.recommendation;
  const active = activeDim && b?.[activeDim]
    ? { ...DIMS.find(d => d.key === activeDim)!, data: b[activeDim] }
    : null;

  return (
    <section className="mb-9">
      <div
        className="cursor-pointer flex justify-between items-baseline select-none mb-1"
        onClick={() => setOpen(!open)}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        role="button" tabIndex={0} aria-expanded={open}
      >
        <h3 className="font-medium text-[16px] tracking-[-0.01em] text-[var(--ed-ink)] m-0">AI Analysis</h3>
        <span className="text-[var(--ed-ink-faint)] text-[13px]" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </div>
      <div className="border-t border-[var(--ed-rule-strong)]" />
      {open && (
        <div className="mt-5">
          {/* Hero */}
          <div className="flex items-center gap-5 pb-6 max-[480px]:flex-col max-[480px]:items-start">
            <ScoreNumber score={a.overallScore} maxScore={100} hero color={edVerdictColor(a.verdict)} />
            <div className="flex flex-col gap-[0.5rem]">
              <div className="text-[16px] font-medium leading-[1.2] text-[var(--ed-ink)]">
                {VERDICT_LABELS[a.verdict] || VERDICT_LABELS.INSUFFICIENT_DATA}
              </div>
              {rec && (
                <div className="text-[13px] font-medium tracking-[0.02em] py-[0.35rem] px-[0.9rem] w-fit rounded-full border border-[var(--ed-rule)] text-[var(--ed-ink-soft)]">
                  {rec.shouldApply ? 'Worth Applying' : 'Not Recommended'}
                </div>
              )}
            </div>
          </div>

          {/* Hard blockers — mechanical gate, not narrative: non-empty always
              means the verdict was forced to STRONG_NO server-side. */}
          {a.hardBlockers && a.hardBlockers.length > 0 && (
            <div className="mb-6 p-[0.9rem_1.1rem] rounded-xl border border-[var(--ed-ink)]">
              <span className={SUBLABEL}>Hard Blockers</span>
              <ul className="list-disc pl-5 m-0">
                {a.hardBlockers.map((item, i) => <li key={i} className="text-[16px] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6]">{item}</li>)}
              </ul>
            </div>
          )}

          {/* Must clarify — genuinely ambiguous requirements, narrative only. */}
          {a.mustClarify && a.mustClarify.length > 0 && (
            <div className="mb-6 p-[0.9rem_1.1rem] rounded-xl border border-[var(--ed-rule)]">
              <span className={SUBLABEL}>Worth Clarifying</span>
              <ul className="list-disc pl-5 m-0">
                {a.mustClarify.map((item, i) => <li key={i} className="text-[16px] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6]">{item}</li>)}
              </ul>
            </div>
          )}

          {/* Dimension cards */}
          {b && (
            <>
              <div className="grid grid-cols-3 gap-[0.6rem] pt-6 border-t border-[var(--ed-rule)] max-[480px]:grid-cols-1">
                {DIMS.map(dim => {
                  const d = b[dim.key];
                  if (!d) return null;
                  const isActive = activeDim === dim.key;
                  return (
                    <button
                      key={dim.key}
                      className={`flex flex-col items-center gap-2 p-[1rem_0.5rem] rounded-xl border cursor-pointer transition-all ${isActive ? 'border-[var(--ed-ink)] bg-[var(--ed-panel)]/60' : 'border-[var(--ed-rule)] hover:border-[var(--ed-ink-faint)]'}`}
                      onClick={() => setActiveDim(isActive ? null : dim.key)}
                    >
                      <ScoreNumber score={d.score} maxScore={d.maxScore} color={edScoreColor(d.score, d.maxScore)} />
                      <span className="text-[13px] text-[var(--ed-ink-soft)] font-medium tracking-[0.02em]">{dim.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Stacked gaps — literal inventory backing the Core Stack score
                  (mechanically capped server-side once 4+ accumulate). */}
              {a.stackedGaps && a.stackedGaps.length > 0 && (
                <div className="mt-3 p-[0.9rem_1.1rem] rounded-xl border border-[var(--ed-rule)]">
                  <span className={SUBLABEL}>Stacked Gaps ({a.stackedGaps.length})</span>
                  <ul className="list-disc pl-5 m-0">
                    {a.stackedGaps.map((item, i) => <li key={i} className="text-[16px] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6]">{item}</li>)}
                  </ul>
                </div>
              )}

              {active && (
                <div className="mt-3 p-[1.1rem_1.25rem] border border-[var(--ed-rule)] animate-in fade-in duration-200" key={activeDim}>
                  <h4 className="font-medium text-[16px] text-[var(--ed-ink)] mb-3">{active.label}</h4>
                  {(active.data[active.posKey] as string[] | undefined)?.length ? (
                    <div className="mb-3 last:mb-0">
                      <span className={SUBLABEL}>{active.posLabel}</span>
                      <ul className="list-disc pl-5 m-0">
                        {(active.data[active.posKey] as string[]).map((item: string, i: number) => <li key={i} className="text-[16px] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6]">{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {(active.data[active.negKey] as string[] | undefined)?.length ? (
                    <div className="mb-3 last:mb-0">
                      <span className={SUBLABEL}>{active.negLabel}</span>
                      <ul className="list-disc pl-5 m-0">
                        {(active.data[active.negKey] as string[]).map((item: string, i: number) => <li key={i} className="text-[16px] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6]">{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}

          {/* Recommendation */}
          {rec && !!(rec.keyReasons?.length || rec.questionsToAsk?.length || rec.greenFlags?.length || rec.redFlags?.length) && (
            <div className="mt-6 pt-4 border-t border-[var(--ed-rule)]">
              <h4 className="font-medium text-[16px] text-[var(--ed-ink)] mb-3">Recommendation</h4>
              {rec.keyReasons?.length ? (
                <div className="mb-3">
                  <span className={SUBLABEL}>Key Reasons</span>
                  <ul dir="auto" className="list-disc ps-5 m-0">
                    {rec.keyReasons.map((item, i) => <li key={i} className="text-[16px] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6]">{item}</li>)}
                  </ul>
                </div>
              ) : null}
              {rec.questionsToAsk?.length ? (
                <div className="mb-3">
                  <span className={SUBLABEL}>Questions to Ask</span>
                  <ul dir="auto" className="list-disc ps-5 m-0">
                    {rec.questionsToAsk.map((item, i) => <li key={i} className="text-[16px] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6]">{item}</li>)}
                  </ul>
                </div>
              ) : null}
              {(rec.greenFlags?.length || rec.redFlags?.length) ? (
                <div className="mt-2">
                  <span className={SUBLABEL}>Green &amp; Red Flags</span>
                  <SignalRows green={rec.greenFlags} red={rec.redFlags} />
                </div>
              ) : null}
            </div>
          )}

          {/* Company news analysis */}
          {a.companyNewsAnalysis && !!(a.companyNewsAnalysis.greenSignals?.length || a.companyNewsAnalysis.redSignals?.length) && (
            <div className="mt-6 pt-4 border-t border-[var(--ed-rule)]">
              <h4 className="font-medium text-[16px] text-[var(--ed-ink)] mb-3">Company News Signals</h4>
              <SignalRows green={a.companyNewsAnalysis.greenSignals} red={a.companyNewsAnalysis.redSignals} />
              {a.companyNewsAnalysis.summary && (
                <p dir="auto" className="text-[16px] text-[var(--ed-ink-soft)] leading-[1.6] mt-2">{a.companyNewsAnalysis.summary}</p>
              )}
            </div>
          )}

          {/* Employee reviews analysis */}
          {a.employeeReviewsAnalysis && !!(a.employeeReviewsAnalysis.greenSignals?.length || a.employeeReviewsAnalysis.redSignals?.length) && (
            <div className="mt-6 pt-4 border-t border-[var(--ed-rule)]">
              <h4 className="font-medium text-[16px] text-[var(--ed-ink)] mb-3">Employee Review Signals</h4>
              <SignalRows green={a.employeeReviewsAnalysis.greenSignals} red={a.employeeReviewsAnalysis.redSignals} />
              {a.employeeReviewsAnalysis.summary && (
                <p dir="auto" className="text-[16px] text-[var(--ed-ink-soft)] leading-[1.6] mt-2">{a.employeeReviewsAnalysis.summary}</p>
              )}
            </div>
          )}

          {/* Honest assessment */}
          {a.honestAssessment && (
            <div className="mt-6 pt-4 border-t border-[var(--ed-rule)]">
              <h4 className="font-medium text-[16px] text-[var(--ed-ink)] mb-3">Honest Assessment</h4>
              <p dir="auto" className="text-[16px] leading-[1.8] text-[var(--ed-ink)] whitespace-pre-wrap ps-4 border-s-2 border-[var(--ed-rule-strong)] m-0">{a.honestAssessment}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
