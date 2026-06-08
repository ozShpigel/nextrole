import { useState } from 'react';
import { VERDICT_LABELS } from '../lib/scoring';
import { scoreColor } from '../lib/format';
import { Card } from '@/components/ui/card';

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
  const color = scoreColor(score, maxScore);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} fill="none" className="block">
        <circle cx={half} cy={half} r={r} stroke="var(--muted)" strokeWidth={stroke} />
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
        <span className="font-serif font-bold text-foreground leading-none" style={{ fontSize: size * 0.2 }}>{score ?? '—'}</span>
        <span className="text-muted-foreground mt-[0.1rem] font-normal" style={{ fontSize: size * 0.09 }}>/ {maxScore}</span>
      </div>
    </div>
  );
}

const VERDICT_COLOR: Record<string, string> = {
  STRONG_YES: 'text-emerald-600',
  YES: 'text-emerald-600',
  MAYBE: 'text-amber-600',
  NO: 'text-red-500',
  STRONG_NO: 'text-red-500',
  INSUFFICIENT_DATA: 'text-muted-foreground',
};

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

export default function AnalysisCard({ matchAnalysisJson }: AnalysisCardProps) {
  const [open, setOpen] = useState(true);
  const [activeDim, setActiveDim] = useState<string | null>(null);

  if (!matchAnalysisJson) return null;
  let a: MatchAnalysis;
  try { a = typeof matchAnalysisJson === 'string' ? JSON.parse(matchAnalysisJson) : matchAnalysisJson; } catch { return null; }

  const b = a.breakdown;
  const rec = a.recommendation;
  const verdictKey = a.verdict?.replace(/ /g, '_') || 'INSUFFICIENT_DATA';
  const verdictColorClass = VERDICT_COLOR[verdictKey] || 'text-muted-foreground';
  const active = activeDim && b?.[activeDim]
    ? { ...DIMS.find(d => d.key === activeDim)!, data: b[activeDim] }
    : null;

  return (
    <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
      <div
        className="cursor-pointer flex justify-between items-center select-none"
        onClick={() => setOpen(!open)}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        role="button" tabIndex={0} aria-expanded={open}
      >
        <h3 className="text-[0.95rem] font-semibold text-foreground" style={{ border: 'none', margin: 0, padding: 0 }}>AI Analysis</h3>
      </div>
      {open && (
        <div className="mt-5">
          {/* Hero */}
          <div className="flex items-center gap-7 pb-6">
            <ScoreRing score={a.overallScore} maxScore={100} size={148} stroke={9} />
            <div className="flex flex-col gap-[0.6rem]">
              <div className={`font-serif text-[1.5rem] font-bold leading-[1.2] tracking-[-0.02em] ${verdictColorClass}`}>
                {VERDICT_LABELS[a.verdict] || VERDICT_LABELS.INSUFFICIENT_DATA}
              </div>
              {rec && (
                <div className={`text-[0.85rem] font-semibold py-[0.3rem] px-[0.9rem] rounded-[20px] w-fit ${rec.shouldApply ? 'bg-emerald-50 text-emerald-600 border border-emerald-600/15' : 'bg-red-50 text-red-500 border border-red-500/15'}`}>
                  {rec.shouldApply ? 'Worth Applying' : 'Not Recommended'}
                </div>
              )}
            </div>
          </div>

          {/* Dimension cards */}
          {b && (
            <>
              <div className="grid grid-cols-3 gap-[0.6rem] pt-6 border-t border-border">
                {DIMS.map(dim => {
                  const d = b[dim.key];
                  if (!d) return null;
                  return (
                    <button
                      key={dim.key}
                      className={`flex flex-col items-center gap-2 p-[1rem_0.5rem] bg-muted border border-border rounded cursor-pointer transition-all font-sans hover:border-border hover:bg-card ${activeDim === dim.key ? 'border-primary! bg-card! shadow-[0_0_0_1px_var(--primary),var(--shadow-sm)]' : ''}`}
                      onClick={() => setActiveDim(activeDim === dim.key ? null : dim.key)}
                    >
                      <ScoreRing score={d.score} maxScore={d.maxScore} size={72} stroke={5} />
                      <span className="text-[0.82rem] text-muted-foreground font-medium">{dim.label}</span>
                    </button>
                  );
                })}
              </div>

              {active && (
                <div className="mt-3 p-[1rem_1.25rem] bg-muted border border-border rounded animate-in fade-in duration-200" key={activeDim}>
                  <h4 className="text-[0.9rem] font-semibold text-foreground mb-3">{active.label}</h4>
                  {(active.data[active.posKey] as string[] | undefined)?.length ? (
                    <div className="mb-3 last:mb-0">
                      <span className="block text-[0.75rem] text-muted-foreground uppercase tracking-[0.06em] font-medium mb-[0.3rem]">{active.posLabel}</span>
                      <ul className="list-disc pl-5 m-0">
                        {(active.data[active.posKey] as string[]).map((item: string, i: number) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-foreground leading-[1.6] marker:text-emerald-600">{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {(active.data[active.negKey] as string[] | undefined)?.length ? (
                    <div className="mb-3 last:mb-0">
                      <span className="block text-[0.75rem] text-muted-foreground uppercase tracking-[0.06em] font-medium mb-[0.3rem]">{active.negLabel}</span>
                      <ul className="list-disc pl-5 m-0">
                        {(active.data[active.negKey] as string[]).map((item: string, i: number) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-foreground leading-[1.6] marker:text-red-500">{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}

          {/* Recommendation */}
          {rec && (rec.keyReasons?.length || rec.questionsToAsk?.length || rec.greenFlags?.length || rec.redFlags?.length) && (
            <div className="mt-5 pt-4 border-t border-border">
              <h4 className="text-[0.9rem] font-semibold text-foreground mb-3">Recommendation</h4>
              {rec.keyReasons?.length ? (
                <div className="mb-3">
                  <span className="block text-[0.75rem] text-muted-foreground uppercase tracking-[0.06em] font-medium mb-[0.3rem]">Key Reasons</span>
                  <ul className="list-disc pl-5 m-0">
                    {rec.keyReasons.map((item, i) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-foreground leading-[1.6]">{item}</li>)}
                  </ul>
                </div>
              ) : null}
              {rec.questionsToAsk?.length ? (
                <div className="mb-3">
                  <span className="block text-[0.75rem] text-muted-foreground uppercase tracking-[0.06em] font-medium mb-[0.3rem]">Questions to Ask</span>
                  <ul className="list-disc pl-5 m-0">
                    {rec.questionsToAsk.map((item, i) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-foreground leading-[1.6]">{item}</li>)}
                  </ul>
                </div>
              ) : null}
              {(rec.greenFlags?.length || rec.redFlags?.length) ? (
                <div className="flex gap-2 flex-wrap mt-2">
                  {(rec.greenFlags || []).map((f, i) => <span key={`g${i}`} className="py-1 px-[0.65rem] rounded-sm text-[0.78rem] font-medium border transition-transform hover:-translate-y-px bg-emerald-50 text-emerald-600 border-emerald-600/12">{f}</span>)}
                  {(rec.redFlags || []).map((f, i) => <span key={`r${i}`} className="py-1 px-[0.65rem] rounded-sm text-[0.78rem] font-medium border transition-transform hover:-translate-y-px bg-red-50 text-red-500 border-red-500/12">{f}</span>)}
                </div>
              ) : null}
            </div>
          )}

          {/* Company news analysis */}
          {a.companyNewsAnalysis && (a.companyNewsAnalysis.greenSignals?.length || a.companyNewsAnalysis.redSignals?.length) && (
            <div className="mt-5 pt-4 border-t border-border">
              <h4 className="text-[0.9rem] font-semibold text-foreground mb-3">Company News Signals</h4>
              <div className="flex gap-2 flex-wrap">
                {(a.companyNewsAnalysis.greenSignals || []).map((s, i) => <span key={`ng${i}`} className="py-1 px-[0.65rem] rounded-sm text-[0.78rem] font-medium border transition-transform hover:-translate-y-px bg-emerald-50 text-emerald-600 border-emerald-600/12">{s}</span>)}
                {(a.companyNewsAnalysis.redSignals || []).map((s, i) => <span key={`nr${i}`} className="py-1 px-[0.65rem] rounded-sm text-[0.78rem] font-medium border transition-transform hover:-translate-y-px bg-red-50 text-red-500 border-red-500/12">{s}</span>)}
              </div>
              {a.companyNewsAnalysis.summary && (
                <p dir="rtl" className="text-[0.84rem] text-muted-foreground leading-[1.6] mt-2 text-right">{a.companyNewsAnalysis.summary}</p>
              )}
            </div>
          )}

          {/* Honest assessment */}
          {a.honestAssessment && (
            <div className="mt-5 pt-4 border-t border-border">
              <h4 className="text-[0.9rem] font-semibold text-foreground mb-3">Honest Assessment</h4>
              <p dir="rtl" className="text-[0.88rem] leading-[1.75] text-foreground whitespace-pre-wrap bg-background border border-border rounded p-5 m-0 text-right">{a.honestAssessment}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
