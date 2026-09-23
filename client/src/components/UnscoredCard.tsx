import { useEffect, useRef } from 'react';
import type { DiscoveredJobSummary } from '../lib/types';
import { CompanyAvatar } from './CompanyAvatar';
import { cityCountry, formatPostedAgo } from '../lib/format';

/**
 * A retrieved posting that has not been scored for this user yet.
 *
 * Deliberately quiet, and deliberately has no number on it. The board's visual
 * weight is the match score, and similarity — the only signal available for
 * free here — was measured against 29 real scores at +0.65 overall but −0.15
 * within the top ten. It orders the field, not the leaderboard, so rendering it
 * as a score would publish a figure that reshuffles the moment the real one
 * arrives. "Not scored yet" is the honest state and costs nothing to be right
 * about.
 *
 * Reports when it has been in view for DWELL_MS so the page can score it.
 *
 * The dwell is not a nicety. Measured by running it: a fast flick down the
 * board brought twenty cards through the viewport at once and requested every
 * one of them — four batches, eight Claude calls, for a gesture that read
 * nothing. Intersection alone means "passed the viewport", and passing is not
 * attention. Waiting for the card to still be there a moment later is.
 */
const DWELL_MS = 400;

export function UnscoredCard({
  job,
  pending,
  onVisible,
}: {
  job: DiscoveredJobSummary;
  /** A scoring request covering this card is in flight. */
  pending: boolean;
  onVisible: (jobId: string) => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  // The callback identity changes on every render (it closes over state), and
  // the observer must not be torn down and rebuilt each time — that would
  // re-fire for cards already on screen. Held in a ref so the effect below can
  // depend on the job id alone.
  const notify = useRef(onVisible);
  notify.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let dwell: ReturnType<typeof setTimeout> | undefined;

    // rootMargin looks slightly ahead of the viewport, so a card the reader is
    // approaching is requested a moment before they reach it.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            dwell ??= setTimeout(() => {
              notify.current(job.id);
              // One shot. The page also tracks what it has asked for, but
              // unobserving here means a card cannot re-fire while its
              // request is still outstanding.
              observer.unobserve(el);
            }, DWELL_MS);
          } else if (dwell) {
            // Scrolled past before the dwell elapsed: not read, not scored.
            clearTimeout(dwell);
            dwell = undefined;
          }
        }
      },
      { rootMargin: '150px' },
    );

    observer.observe(el);
    return () => {
      if (dwell) clearTimeout(dwell);
      observer.disconnect();
    };
  }, [job.id]);

  const posted = formatPostedAgo(job.date_posted);

  return (
    <div
      ref={ref}
      data-testid="unscored-card"
      data-job-id={job.id}
      className="rounded-2xl border border-dashed border-[var(--ed-rule)] p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <CompanyAvatar name={job.company} logo={job.company_logo} size={32} />
        <span
          className="text-[13px] text-[var(--ed-ink-faint)] tabular-nums"
          aria-live="off"
        >
          {pending ? 'Scoring…' : 'Not scored yet'}
        </span>
      </div>

      <div>
        <p className="text-[13px] text-[var(--ed-ink-faint)]">
          {job.company}
          {job.location ? <span className="pl-2">{cityCountry(job.location)}</span> : null}
        </p>
        <p className="text-[16px] font-medium text-[var(--ed-ink-soft)] leading-snug">
          {job.title}
        </p>
        {posted ? (
          <p className="text-[13px] text-[var(--ed-ink-faint)] pt-1">{posted}</p>
        ) : null}
      </div>
    </div>
  );
}
