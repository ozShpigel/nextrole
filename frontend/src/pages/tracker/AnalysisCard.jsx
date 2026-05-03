import { useState } from 'react';
import { VERDICT_LABELS } from '../../utils/constants';
import { scoreColor } from '../../utils/format';
import { Card } from '@/components/ui/card';

function ScoreRing({ score, maxScore, size = 140, stroke = 8 }) {
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
            className="animate-ring-draw"
            style={{ '--circ': C, transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
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

const VERDICT_COLOR = {
  STRONG_YES: 'text-green',
  YES: 'text-green',
  MAYBE: 'text-yellow',
  NO: 'text-red',
  STRONG_NO: 'text-red',
  INSUFFICIENT_DATA: 'text-muted-foreground',
};

const DIMS = [
  { key: 'technical', label: 'Technical', posLabel: 'Strengths', negLabel: 'Gaps', posKey: 'strengths', negKey: 'gaps' },
  { key: 'cultural', label: 'Cultural', posLabel: 'Positive Signals', negLabel: 'Concerns', posKey: 'positiveSignals', negKey: 'concerns' },
  { key: 'roleCharacteristics', label: 'Role Fit', posLabel: 'Opportunities', negLabel: 'Risks', posKey: 'opportunities', negKey: 'risks' },
];

export default function AnalysisCard({ matchAnalysisJson }) {
  const [open, setOpen] = useState(true);
  const [activeDim, setActiveDim] = useState(null);

  if (!matchAnalysisJson) return null;
  let a;
  try { a = typeof matchAnalysisJson === 'string' ? JSON.parse(matchAnalysisJson) : matchAnalysisJson; } catch { return null; }

  const b = a.breakdown;
  const rec = a.recommendation;
  const verdictKey = a.verdict?.replace(/ /g, '_') || 'INSUFFICIENT_DATA';
  const verdictColorClass = VERDICT_COLOR[verdictKey] || 'text-muted-foreground';
  const active = activeDim && b?.[activeDim]
    ? { ...DIMS.find(d => d.key === activeDim), data: b[activeDim] }
    : null;

  return (
    <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
      <div
        className="cursor-pointer flex justify-between items-center select-none"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
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
                <div className={`text-[0.85rem] font-semibold py-[0.3rem] px-[0.9rem] rounded-[20px] w-fit ${rec.shouldApply ? 'bg-green-bg text-green border border-[rgba(45,143,94,0.15)]' : 'bg-red-bg text-red border border-[rgba(196,84,84,0.15)]'}`}>
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
                <div className="mt-3 p-[1rem_1.25rem] bg-muted border border-border rounded animate-detail-reveal" key={activeDim}>
                  <h4 className="text-[0.9rem] font-semibold text-foreground mb-3">{active.label}</h4>
                  {active.data[active.posKey]?.length > 0 && (
                    <div className="mb-3 last:mb-0">
                      <span className="block text-[0.75rem] text-muted-foreground uppercase tracking-[0.06em] font-medium mb-[0.3rem]">{active.posLabel}</span>
                      <ul className="list-disc pl-5 m-0">
                        {active.data[active.posKey].map((item, i) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-foreground leading-[1.6] marker:text-green">{item}</li>)}
                      </ul>
                    </div>
                  )}
                  {active.data[active.negKey]?.length > 0 && (
                    <div className="mb-3 last:mb-0">
                      <span className="block text-[0.75rem] text-muted-foreground uppercase tracking-[0.06em] font-medium mb-[0.3rem]">{active.negLabel}</span>
                      <ul className="list-disc pl-5 m-0">
                        {active.data[active.negKey].map((item, i) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-foreground leading-[1.6] marker:text-red">{item}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Recommendation */}
          {rec && (rec.keyReasons?.length > 0 || rec.questionsToAsk?.length > 0 || rec.greenFlags?.length > 0 || rec.redFlags?.length > 0) && (
            <div className="mt-5 pt-4 border-t border-border">
              <h4 className="text-[0.9rem] font-semibold text-foreground mb-3">Recommendation</h4>
              {rec.keyReasons?.length > 0 && (
                <div className="mb-3">
                  <span className="block text-[0.75rem] text-muted-foreground uppercase tracking-[0.06em] font-medium mb-[0.3rem]">Key Reasons</span>
                  <ul className="list-disc pl-5 m-0">
                    {rec.keyReasons.map((item, i) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-foreground leading-[1.6]">{item}</li>)}
                  </ul>
                </div>
              )}
              {rec.questionsToAsk?.length > 0 && (
                <div className="mb-3">
                  <span className="block text-[0.75rem] text-muted-foreground uppercase tracking-[0.06em] font-medium mb-[0.3rem]">Questions to Ask</span>
                  <ul className="list-disc pl-5 m-0">
                    {rec.questionsToAsk.map((item, i) => <li key={i} className="text-[0.84rem] mb-[0.3rem] text-foreground leading-[1.6]">{item}</li>)}
                  </ul>
                </div>
              )}
              {(rec.greenFlags?.length > 0 || rec.redFlags?.length > 0) && (
                <div className="flex gap-2 flex-wrap mt-2">
                  {(rec.greenFlags || []).map((f, i) => <span key={`g${i}`} className="py-1 px-[0.65rem] rounded-sm text-[0.78rem] font-medium border transition-transform hover:-translate-y-px bg-green-bg text-green border-[rgba(45,143,94,0.12)]">{f}</span>)}
                  {(rec.redFlags || []).map((f, i) => <span key={`r${i}`} className="py-1 px-[0.65rem] rounded-sm text-[0.78rem] font-medium border transition-transform hover:-translate-y-px bg-red-bg text-red border-[rgba(196,84,84,0.12)]">{f}</span>)}
                </div>
              )}
            </div>
          )}

          {/* Company news analysis */}
          {a.companyNewsAnalysis && (a.companyNewsAnalysis.greenSignals?.length > 0 || a.companyNewsAnalysis.redSignals?.length > 0) && (
            <div className="mt-5 pt-4 border-t border-border">
              <h4 className="text-[0.9rem] font-semibold text-foreground mb-3">Company News Signals</h4>
              <div className="flex gap-2 flex-wrap">
                {(a.companyNewsAnalysis.greenSignals || []).map((s, i) => <span key={`ng${i}`} className="py-1 px-[0.65rem] rounded-sm text-[0.78rem] font-medium border transition-transform hover:-translate-y-px bg-green-bg text-green border-[rgba(45,143,94,0.12)]">{s}</span>)}
                {(a.companyNewsAnalysis.redSignals || []).map((s, i) => <span key={`nr${i}`} className="py-1 px-[0.65rem] rounded-sm text-[0.78rem] font-medium border transition-transform hover:-translate-y-px bg-red-bg text-red border-[rgba(196,84,84,0.12)]">{s}</span>)}
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
