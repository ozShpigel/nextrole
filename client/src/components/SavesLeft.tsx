import { useAddAllowance } from '../lib/queries';

/**
 * "2 saves left today ●●○" -- the daily limit on adding jobs to the Active
 * board (ActiveBoardAllowance on the server, which is what enforces it; this
 * only shows it). Nothing while loading or when the read fails.
 */
export function SavesLeft() {
  const { data } = useAddAllowance();
  if (!data) return null;
  const { remaining, limit } = data;
  const none = remaining <= 0;
  return (
    <span
      data-testid="saves-left"
      className={`inline-flex items-center gap-3 rounded-full border px-4 py-[0.4rem] text-[13px] font-medium ${
        none
          ? 'border-[var(--ed-rule)] text-[var(--ed-ink-faint)]'
          : 'border-[var(--ed-accent)]/40 bg-[var(--ed-accent)]/10 text-[var(--ed-accent)]'
      }`}
    >
      {none ? 'No saves left today' : `${remaining} ${remaining === 1 ? 'save' : 'saves'} left today`}
      <span aria-hidden="true" className="inline-flex items-center gap-[5px]">
        {Array.from({ length: limit }, (_, i) => (
          <span
            key={i}
            className={`w-[7px] h-[7px] rounded-full ${i < remaining ? 'bg-[var(--ed-accent)]' : 'border border-[var(--ed-ink-faint)]'}`}
          />
        ))}
      </span>
    </span>
  );
}
