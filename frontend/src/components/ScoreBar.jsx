import { barColor } from '../utils/format';

export default function ScoreBar({ label, score, maxScore }) {
  const hasScore = score != null && maxScore != null && maxScore > 0;
  const pct = hasScore ? (score / maxScore * 100).toFixed(0) : '0';
  const color = barColor(score, maxScore);

  return (
    <div className="score-bar">
      <span className="label">{label}</span>
      <div className="bar-bg">
        <div className={`bar-fill ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="score-num">{score != null ? score : 'N/A'}/{maxScore != null ? maxScore : '?'}</span>
    </div>
  );
}
