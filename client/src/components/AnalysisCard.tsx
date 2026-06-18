import { useState } from 'react';
import { VERDICT_LABELS } from '../lib/scoring';

// Editorial score tint (var(--ed-*), valid only inside the .editorial scope)
function edScoreColor(score: number | null | undefined, max?: number | null): string {
  if (score == null) return 'var(--ed-ink-faint)';
  const pct = max != null && max > 0 ? score / max : score / 100;
  if (pct >= 0.6) return 'var(--ed-yes)';
  if (pct >= 0.4) return 'var(--ed-gold)';
  return 'var(--ed-no)';
}

function edVerdictColor(verdictKey: string): string {
  switch (verdictKey) {
    case 'STRONG_YES':
    case 'YES': return 'var(--ed-yes)';
    case 'MAYBE': return 'var(--ed-gold)';
    case 'NO':
    case 'STRONG_NO': return 'var(--ed-no)';
    default: return 'var(--ed-ink-faint)';
  }
}

interface ScoreRingProps {
  score: number | null | undefined;
  maxScore: number;
  size?: number;
  stroke?: number;
}

function ScoreRing({ score, maxScore, size = 140, stroke = 8 }: ScoreRingProps) {
  const pct = score != null && maxScore > 0 ? score / maxScore : 0;
  const half = size / 2;
  const r = half - stroke / 2 - 2;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - pct);
  const color = edScoreColor(score, maxScore);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} fill="none" className="block">
        <circle cx={half} cy={half} r={r} stroke="var(--ed-rule)" strokeWidth={stroke} />
        {score != null && (
          <circle
            cx={half} cy={half} r={r}
            stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={offset}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="ed-display font-black text-[var(--ed-ink)] leading-none tabular-nums" style={{ fontSize: size * 0.22 }}>{score ?? '—'}</span>
        <span className="text-[var(--ed-ink-faint)] mt-[0.1rem] font-normal" style={{ fontSize: size * 0.09 }}>/ {maxScore}</span>
      </div>
    </div>
  );
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

interface CompanyNewsAnalysis {
  greenSignals?: string[];
  redSignals?: string[];
  summary?: string;
}

interface MatchAnalysis {
  overallScore: number;
  verdict: string;
  breakdown?: Record<string, DimensionData>;
  recommendation?: Recommendation;
  companyNewsAnalysis?: CompanyNewsAnalysis;
  honestAssessment?: string;
}

interface AnalysisCardProps {
  matchAnalysisJson: string | MatchAnalysis | null | undefined;
}

const SUBLABEL = 'block text-[0.62rem] text-[var(--ed-ink-faint)] uppercase tracking-[0.14em] font-semibold mb-[0.4rem]';

// Editorial +/- signal footnotes — calmer than filled chips for the long
// sentence-length flags the evaluator returns.
function SignalRows({ green = [], red = [] }: { green?: string[]; red?: string[] }) {
  return (
    <div className="flex flex-col gap-[0.45rem]" dir="rtl">
      {green.map((s, i) => (
        <div key={`g${i}`} className="flex items-start gap-[0.55rem]">
          <span className="ed-display text-[0.95rem] font-bold leading-[1.2] text-[var(--ed-yes)] shrink-0" aria-hidden="true">+</span>
          <span className="text-[0.84rem] text-[var(--ed-ink)] leading-[1.55] text-right">{s}</span>
        </div>
      ))}
      {red.map((s, i) => (
        <div key={`r${i}`} className="flex items-start gap-[0.55rem]">
          <span className="ed-display text-[0.95rem] font-bold leading-[1.2] text-[var(--ed-no)] shrink-0" aria-hidden="true">–</span>
          <span className="text-[0.84rem] text-[var(--ed-ink)] leading-[1.55] text-right">{s}</span>
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
  try { a = typeof matchAnalysisJson === 'string' ? JSON.parse(matchAnalysisJson) : matchAnalysisJson; } catch { return null; }

  const b = a.breakdown;
  const rec = a.recommendation;
  const verdictKey = a.verdict?.replace(/ /g, '_') || 'INSUFFICIENT_DATA';
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
        <span className="ed-display italic font-semibold text-[1.4rem] tracking-[-0.01em] text-[var(--ed-ink)]">AI Analysis</span>
        <span className="text-[var(--ed-accent)] text-[0.9rem]" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </div>
      <div className="border-t border-[var(--ed-rule-strong)]" />
      {open && (
        <div className="mt-5">
          {/* Hero */}
          <div className="flex items-center gap-7 pb-6 max-[480px]:flex-col max-[480px]:items-start">
            <ScoreRing score={a.overallScore} maxScore={100} size={148} stroke={9} />
            <div className="flex flex-col gap-[0.7rem]">
              <div className="ed-display text-[1.7rem] font-bold leading-[1.1] tracking-[-0.02em]" style={{ color: edVerdictColor(verdictKey) }}>
                {VERDICT_LABELS[a.verdict] || VERDICT_LABELS.INSUFFICIENT_DATA}
              </div>
              {rec && (
                <div className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] py-[0.35rem] px-[0.9rem] w-fit border" style={
                  rec.shouldApply
                    ? { color: 'var(--ed-yes)', borderColor: 'color-mix(in oklab, var(--ed-yes) 30%, transparent)' }
                    : { color: 'var(--ed-no)', borderColor: 'color-mix(in oklab, var(--ed-no) 30%, transparent)' }
                }>
                  {rec.shouldApply ? 'Worth Applying' : 'Not Recommended'}
                </div>
              )}
            </div>
          </div>

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
                      className={`flex flex-col items-center gap-2 p-[1rem_0.5rem] border cursor-pointer transition-all ${isActive ? 'border-[var(--ed-ink)] bg-[var(--ed-panel)]/60' : 'border-[var(--ed-rule)] hover:border-[var(--ed-ink-faint)]'}`}
                      onClick={() => setActiveDim(isActive ? null : dim.key)}
                    >
                      <ScoreRing score={d.score} maxScore={d.maxScore} size={72} stroke={5} />
                      <span className="text-[0.66rem] text-[var(--ed-ink-soft)] font-semibold uppercase tracking-[0.08em]">{dim.label}</span>
                    </button>
                  );
                })}
              </div>

              {active && (
                <div className="mt-3 p-[1.1rem_1.25rem] bg-[var(--ed-panel)] border border-[var(--ed-rule)] animate-in fade-in duration-200" key={activeDim}>
                  <h4 className="ed-display text-[1rem] font-semibold text-[var(--ed-ink)] mb-3">{active.label}</h4>
                  {(active.data[active.posKey] as string[] | undefined)?.length ? (
                    <div className="mb-3 last:mb-0">
                      <span className={SUBLABEL}>{active.posLabel}</span>
                      <ul dir="rtl" className="list-disc pr-5 m-0 text-right">
                        {(active.data[active.posKey] as string[]).map((item: string, i: number) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6] marker:text-[var(--ed-yes)]">{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {(active.data[active.negKey] as string[] | undefined)?.length ? (
                    <div className="mb-3 last:mb-0">
                      <span className={SUBLABEL}>{active.negLabel}</span>
                      <ul dir="rtl" className="list-disc pr-5 m-0 text-right">
                        {(active.data[active.negKey] as string[]).map((item: string, i: number) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6] marker:text-[var(--ed-no)]">{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}

          {/* Recommendation */}
          {rec && (rec.keyReasons?.length || rec.questionsToAsk?.length || rec.greenFlags?.length || rec.redFlags?.length) && (
            <div className="mt-6 pt-4 border-t border-[var(--ed-rule)]">
              <h4 className="ed-display text-[1rem] font-semibold text-[var(--ed-ink)] mb-3">Recommendation</h4>
              {rec.keyReasons?.length ? (
                <div className="mb-3">
                  <span className={SUBLABEL}>Key Reasons</span>
                  <ul dir="rtl" className="list-disc pr-5 m-0 text-right">
                    {rec.keyReasons.map((item, i) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6]">{item}</li>)}
                  </ul>
                </div>
              ) : null}
              {rec.questionsToAsk?.length ? (
                <div className="mb-3">
                  <span className={SUBLABEL}>Questions to Ask</span>
                  <ul dir="rtl" className="list-disc pr-5 m-0 text-right">
                    {rec.questionsToAsk.map((item, i) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-[var(--ed-ink)] leading-[1.6]">{item}</li>)}
                  </ul>
                </div>
              ) : null}
              {(rec.greenFlags?.length || rec.redFlags?.length) ? (
                <div className="mt-2">
                  <SignalRows green={rec.greenFlags} red={rec.redFlags} />
                </div>
              ) : null}
            </div>
          )}

          {/* Company news analysis */}
          {a.companyNewsAnalysis && (a.companyNewsAnalysis.greenSignals?.length || a.companyNewsAnalysis.redSignals?.length) && (
            <div className="mt-6 pt-4 border-t border-[var(--ed-rule)]">
              <h4 className="ed-display text-[1rem] font-semibold text-[var(--ed-ink)] mb-3">Company News Signals</h4>
              <SignalRows green={a.companyNewsAnalysis.greenSignals} red={a.companyNewsAnalysis.redSignals} />
              {a.companyNewsAnalysis.summary && (
                <p dir="rtl" className="text-[0.84rem] text-[var(--ed-ink-soft)] leading-[1.6] mt-2 text-right">{a.companyNewsAnalysis.summary}</p>
              )}
            </div>
          )}

          {/* Honest assessment */}
          {a.honestAssessment && (
            <div className="mt-6 pt-4 border-t border-[var(--ed-rule)]">
              <h4 className="ed-display text-[1rem] font-semibold text-[var(--ed-ink)] mb-3">Honest Assessment</h4>
              <p dir="rtl" className="text-[0.9rem] leading-[1.8] text-[var(--ed-ink)] whitespace-pre-wrap pr-4 border-r-2 border-[var(--ed-accent)] m-0 text-right">{a.honestAssessment}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
