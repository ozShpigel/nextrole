import ScoreBar from '../../components/ScoreBar';
import { VERDICT_HE } from '../../utils/constants';

function ItemList({ items, className }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="match-list">
      {items.map((item, i) => <li key={i} className={className}>{item}</li>)}
    </ul>
  );
}

export default function MatchResult({ data }) {
  const b = data.breakdown;
  const r = data.recommendation;

  return (
    <div>
      {/* Verdict */}
      <div className="match-card">
        <div className={`match-verdict ${data.verdict}`}>{VERDICT_HE[data.verdict] || data.verdict}</div>
        <div className="match-overall-score">ציון כולל: {data.overallScore ?? 'N/A'} / 100</div>
      </div>

      {/* Score Breakdown */}
      <div className="match-card">
        <h3>פירוט</h3>
        <ScoreBar label="טכני" score={b.technical.score} maxScore={b.technical.maxScore} />
        <ScoreBar label="תרבותי" score={b.cultural.score} maxScore={b.cultural.maxScore} />
        <ScoreBar label="התאמה לתפקיד" score={b.roleCharacteristics.score} maxScore={b.roleCharacteristics.maxScore} />
      </div>

      {/* Technical */}
      <div className="match-card match-section">
        <h3>טכני</h3>
        <p className="match-sub-label">חוזקות</p>
        <ItemList items={b.technical.strengths} className="positive" />
        <p className="match-sub-label gap">פערים</p>
        <ItemList items={b.technical.gaps} className="negative" />
      </div>

      {/* Cultural */}
      <div className="match-card match-section">
        <h3>תרבותי</h3>
        <p className="match-sub-label">סימנים חיוביים</p>
        <ItemList items={b.cultural.positiveSignals} className="positive" />
        <p className="match-sub-label gap">חששות</p>
        <ItemList items={b.cultural.concerns} className="negative" />
      </div>

      {/* Role Characteristics */}
      <div className="match-card match-section">
        <h3>מאפייני התפקיד</h3>
        <p className="match-sub-label">הזדמנויות</p>
        <ItemList items={b.roleCharacteristics.opportunities} className="positive" />
        <p className="match-sub-label gap">סיכונים</p>
        <ItemList items={b.roleCharacteristics.risks} className="negative" />
      </div>

      {/* Recommendation */}
      {r && (
        <div className="match-card match-section">
          <h3>המלצה</h3>
          <p className={`match-recommendation-label ${r.shouldApply ? 'yes' : 'no'}`}>
            {r.shouldApply ? 'כדאי להגיש' : 'לא כדאי להגיש'}
          </p>
          <p className="match-sub-label">סיבות מרכזיות</p>
          <ItemList items={r.keyReasons} />
          <p className="match-sub-label gap">שאלות לראיון</p>
          <ItemList items={r.questionsToAsk} />
          <div className="match-flags">
            {(r.greenFlags || []).map((f, i) => <span key={i} className="match-flag green">{f}</span>)}
            {(r.redFlags || []).map((f, i) => <span key={i} className="match-flag red">{f}</span>)}
          </div>
        </div>
      )}

      {/* Honest Assessment */}
      {data.honestAssessment && (
        <div className="match-card match-section">
          <h3>הערכה כנה</h3>
          <div className="match-assessment">{data.honestAssessment}</div>
        </div>
      )}
    </div>
  );
}
