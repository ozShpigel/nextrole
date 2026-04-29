import { useState } from 'react';
import { VERDICT_HE } from '../../utils/constants';

function scoreColor(score, max) {
  if (score == null || max == null || max === 0) return 'var(--text-dim)';
  const pct = score / max;
  if (pct >= 0.6) return 'var(--green)';
  if (pct >= 0.4) return 'var(--yellow)';
  return 'var(--red)';
}

function ScoreRing({ score, maxScore, size = 140, stroke = 8 }) {
  const pct = score != null && maxScore > 0 ? score / maxScore : 0;
  const half = size / 2;
  const r = half - stroke / 2 - 2;
  const C = 2 * Math.PI * r;
  const offset = C * (1 - pct);
  const color = scoreColor(score, maxScore);

  return (
    <div className="a-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle cx={half} cy={half} r={r} stroke="var(--bg-elevated)" strokeWidth={stroke} />
        {score != null && (
          <circle
            cx={half} cy={half} r={r}
            stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={offset}
            className="a-ring__arc"
            style={{ '--circ': C, transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
          />
        )}
      </svg>
      <div className="a-ring__center">
        <span className="a-ring__num" style={{ fontSize: size * 0.2 }}>{score ?? '—'}</span>
        <span className="a-ring__max" style={{ fontSize: size * 0.09 }}>/ {maxScore}</span>
      </div>
    </div>
  );
}

const DIMS = [
  { key: 'technical', label: 'טכני', posLabel: 'חוזקות', negLabel: 'פערים', posKey: 'strengths', negKey: 'gaps' },
  { key: 'cultural', label: 'תרבותי', posLabel: 'סימנים חיוביים', negLabel: 'חששות', posKey: 'positiveSignals', negKey: 'concerns' },
  { key: 'roleCharacteristics', label: 'התאמה לתפקיד', posLabel: 'הזדמנויות', negLabel: 'סיכונים', posKey: 'opportunities', negKey: 'risks' },
];

export default function AnalysisCard({ matchAnalysisJson }) {
  const [open, setOpen] = useState(true);
  const [activeDim, setActiveDim] = useState(null);

  if (!matchAnalysisJson) return null;
  let a;
  try { a = typeof matchAnalysisJson === 'string' ? JSON.parse(matchAnalysisJson) : matchAnalysisJson; } catch { return null; }

  const b = a.breakdown;
  const rec = a.recommendation;
  const verdictClass = a.verdict?.replace(/ /g, '_') || 'INSUFFICIENT_DATA';
  const active = activeDim && b?.[activeDim]
    ? { ...DIMS.find(d => d.key === activeDim), data: b[activeDim] }
    : null;

  return (
    <div className="card">
      <div
        className={`collapsible-header${open ? '' : ' collapsed'}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        role="button" tabIndex={0} aria-expanded={open}
      >
        <h3 className="section-title" style={{ border: 'none', margin: 0, padding: 0 }}>ניתוח AI</h3>
      </div>
      {open && (
        <div className="a-card">
          <div className="a-hero">
            <ScoreRing score={a.overallScore} maxScore={100} size={148} stroke={9} />
            <div className="a-hero__info">
              <div className={`a-verdict ${verdictClass}`}>
                {VERDICT_HE[a.verdict] || VERDICT_HE.INSUFFICIENT_DATA}
              </div>
              {rec && (
                <div className={`a-apply ${rec.shouldApply ? 'a-apply--yes' : 'a-apply--no'}`}>
                  {rec.shouldApply ? 'כדאי להגיש' : 'לא כדאי להגיש'}
                </div>
              )}
            </div>
          </div>

          {b && (
            <>
              <div className="a-dims">
                {DIMS.map(dim => {
                  const d = b[dim.key];
                  if (!d) return null;
                  return (
                    <button
                      key={dim.key}
                      className={`a-dim${activeDim === dim.key ? ' a-dim--active' : ''}`}
                      onClick={() => setActiveDim(activeDim === dim.key ? null : dim.key)}
                    >
                      <ScoreRing score={d.score} maxScore={d.maxScore} size={72} stroke={5} />
                      <span className="a-dim__label">{dim.label}</span>
                    </button>
                  );
                })}
              </div>

              {active && (
                <div className="a-dim-detail" key={activeDim}>
                  <h4 className="a-dim-detail__title">{active.label}</h4>
                  {active.data[active.posKey]?.length > 0 && (
                    <div className="a-dim-detail__group">
                      <span className="a-dim-detail__sub">{active.posLabel}</span>
                      <ul className="a-dim-detail__list a-dim-detail__list--pos">
                        {active.data[active.posKey].map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                  {active.data[active.negKey]?.length > 0 && (
                    <div className="a-dim-detail__group">
                      <span className="a-dim-detail__sub">{active.negLabel}</span>
                      <ul className="a-dim-detail__list a-dim-detail__list--neg">
                        {active.data[active.negKey].map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {rec && (rec.keyReasons?.length > 0 || rec.questionsToAsk?.length > 0 || rec.greenFlags?.length > 0 || rec.redFlags?.length > 0) && (
            <div className="a-rec">
              <h4 className="a-rec__title">המלצה</h4>
              {rec.keyReasons?.length > 0 && (
                <div className="a-rec__block">
                  <span className="a-rec__label">סיבות עיקריות</span>
                  <ul className="a-rec__list">
                    {rec.keyReasons.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                </div>
              )}
              {rec.questionsToAsk?.length > 0 && (
                <div className="a-rec__block">
                  <span className="a-rec__label">שאלות לשאול</span>
                  <ul className="a-rec__list">
                    {rec.questionsToAsk.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                </div>
              )}
              {(rec.greenFlags?.length > 0 || rec.redFlags?.length > 0) && (
                <div className="a-flags">
                  {(rec.greenFlags || []).map((f, i) => <span key={`g${i}`} className="a-flag a-flag--green">{f}</span>)}
                  {(rec.redFlags || []).map((f, i) => <span key={`r${i}`} className="a-flag a-flag--red">{f}</span>)}
                </div>
              )}
            </div>
          )}

          {a.honestAssessment && (
            <div className="a-assessment">
              <h4 className="a-assessment__title">הערכה כנה</h4>
              <p className="a-assessment__text">{a.honestAssessment}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
