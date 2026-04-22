import { useState } from 'react';
import { barColor } from '../../utils/format';
import { VERDICT_HE } from '../../utils/constants';

function AnalysisScoreBar({ label, score, maxScore }) {
  if (score == null || maxScore == null) return null;
  const pct = (score / maxScore * 100).toFixed(0);
  const color = barColor(score, maxScore);
  return (
    <div className="analysis-score-bar">
      <span className="analysis-bar-label">{label}</span>
      <div className="analysis-bar-bg">
        <div className={`analysis-bar-fill fill-${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="analysis-bar-num">{score}/{maxScore}</span>
    </div>
  );
}

function AnalysisList({ items, className }) {
  if (!items || items.length === 0) return <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '0.25rem 0' }}>-</p>;
  return (
    <ul className="analysis-list">
      {items.map((item, i) => <li key={i} className={className}>{item}</li>)}
    </ul>
  );
}

export default function AnalysisCard({ matchAnalysisJson }) {
  const [open, setOpen] = useState(true);

  if (!matchAnalysisJson) return null;

  let a;
  try {
    a = typeof matchAnalysisJson === 'string' ? JSON.parse(matchAnalysisJson) : matchAnalysisJson;
  } catch {
    return null;
  }

  const b = a.breakdown;
  const r = a.recommendation;
  const verdictClass = a.verdict ? a.verdict.replace(/ /g, '_') : 'INSUFFICIENT_DATA';

  return (
    <div className="card">
      <div
        className={`collapsible-header${open ? '' : ' collapsed'}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <h3 className="section-title" style={{ border: 'none', margin: 0, padding: 0 }}>ניתוח AI</h3>
      </div>
      {open && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div className={`analysis-verdict ${verdictClass}`}>{VERDICT_HE[a.verdict] || VERDICT_HE.INSUFFICIENT_DATA}</div>
              <div className="analysis-overall-score">ציון כללי: {a.overallScore ?? 'N/A'} / 100</div>
            </div>
          </div>

          {b && (
            <>
              <div className="analysis-section">
                <h4>ציונים</h4>
                {b.technical && <AnalysisScoreBar label="טכני" score={b.technical.score} maxScore={b.technical.maxScore} />}
                {b.cultural && <AnalysisScoreBar label="תרבותי" score={b.cultural.score} maxScore={b.cultural.maxScore} />}
                {b.roleCharacteristics && <AnalysisScoreBar label="התאמה לתפקיד" score={b.roleCharacteristics.score} maxScore={b.roleCharacteristics.maxScore} />}
              </div>

              {b.technical && (
                <div className="analysis-section">
                  <h4>טכני</h4>
                  <div className="analysis-sub-label">חוזקות</div>
                  <AnalysisList items={b.technical.strengths} className="a-positive" />
                  <div className="analysis-sub-label">פערים</div>
                  <AnalysisList items={b.technical.gaps} className="a-negative" />
                </div>
              )}

              {b.cultural && (
                <div className="analysis-section">
                  <h4>תרבות</h4>
                  <div className="analysis-sub-label">סימנים חיוביים</div>
                  <AnalysisList items={b.cultural.positiveSignals} className="a-positive" />
                  <div className="analysis-sub-label">חששות</div>
                  <AnalysisList items={b.cultural.concerns} className="a-negative" />
                </div>
              )}

              {b.roleCharacteristics && (
                <div className="analysis-section">
                  <h4>מאפייני התפקיד</h4>
                  <div className="analysis-sub-label">הזדמנויות</div>
                  <AnalysisList items={b.roleCharacteristics.opportunities} className="a-positive" />
                  <div className="analysis-sub-label">סיכונים</div>
                  <AnalysisList items={b.roleCharacteristics.risks} className="a-negative" />
                </div>
              )}
            </>
          )}

          {r && (
            <div className="analysis-section">
              <h4>המלצה</h4>
              <div className={`analysis-should-apply ${r.shouldApply ? 'yes' : 'no'}`}>
                {r.shouldApply ? 'כדאי להגיש' : 'לא כדאי להגיש'}
              </div>
              <div className="analysis-sub-label">סיבות עיקריות</div>
              <AnalysisList items={r.keyReasons} />
              <div className="analysis-sub-label">שאלות לשאול</div>
              <AnalysisList items={r.questionsToAsk} />
              <div className="analysis-flags">
                {(r.greenFlags || []).map((f, i) => <span key={i} className="analysis-flag flag-green">{f}</span>)}
                {(r.redFlags || []).map((f, i) => <span key={i} className="analysis-flag flag-red">{f}</span>)}
              </div>
            </div>
          )}

          {a.honestAssessment && (
            <div className="analysis-section">
              <h4>הערכה כנה</h4>
              <div className="analysis-assessment">{a.honestAssessment}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
