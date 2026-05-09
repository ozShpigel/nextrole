import { barColor } from '../lib/format';

const BAR_COLORS: Record<string, string> = {
  green: 'bg-emerald-600',
  yellow: 'bg-amber-600',
  red: 'bg-red-500',
};

interface ScoreBarProps {
  label: string;
  score: number | null | undefined;
  maxScore: number | null | undefined;
}

export default function ScoreBar({ label, score, maxScore }: ScoreBarProps) {
  const hasScore = score != null && maxScore != null && maxScore > 0;
  const pct = hasScore ? (score / maxScore * 100).toFixed(0) : '0';
  const color = barColor(score, maxScore);

  return (
    <div className="flex items-center gap-3 mb-[0.65rem]">
      <span className="min-w-[130px] text-[0.82rem] text-muted-foreground">{label}</span>
      <div className="flex-1 h-[22px] bg-muted rounded-sm overflow-hidden border border-border">
        <div
          className={`h-full rounded-[5px] transition-[width] duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)] flex items-center justify-center text-[0.72rem] font-semibold ${BAR_COLORS[color] || 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="min-w-[30px] text-start text-[0.82rem] text-muted-foreground">{score != null ? score : 'N/A'}/{maxScore != null ? maxScore : '?'}</span>
    </div>
  );
}
