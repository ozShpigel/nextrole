import { useEffect, useRef, type RefObject } from 'react';

/**
 * How long a card must stay in view before it counts as read.
 *
 * The dwell is not a nicety. Measured by running it: a fast flick down the
 * board brought twenty cards through the viewport at once and requested every
 * one of them — four batches, eight Claude calls, for a gesture that read
 * nothing. Intersection alone means "passed the viewport", and passing is not
 * attention. Waiting for the card to still be there a moment later is.
 */
export const DWELL_MS = 400;

/**
 * Calls `onDwell(id)` once, when the element has stayed in (or near) the
 * viewport for DWELL_MS. Pass `undefined` to switch it off — a card that is
 * already scored, added or dismissed has nothing to ask for.
 */
export function useDwell(
  ref: RefObject<Element | null>,
  id: string,
  onDwell: ((id: string) => void) | undefined,
): void {
  const notify = useRef(onDwell);
  notify.current = onDwell;
  const enabled = !!onDwell;

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    let dwell: ReturnType<typeof setTimeout> | undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            dwell ??= setTimeout(() => {
              notify.current?.(id);
              observer.unobserve(el);
            }, DWELL_MS);
          } else if (dwell) {
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
  }, [ref, id, enabled]);
}
