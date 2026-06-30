import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string };

/**
 * A controlled <textarea> that grows to fit its content — no inner scrollbar,
 * the full text is always visible. A `min-height` (via `style`) still acts as a
 * floor; the box only ever grows past it. Height is recomputed whenever `value`
 * changes (typing, programmatic load/restore) and on viewport resize (wrapping).
 */
export function AutoGrowTextarea({ value, style, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize(): void {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  useLayoutEffect(resize, [value]);

  useLayoutEffect(() => {
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <textarea
      ref={ref}
      value={value}
      style={{ ...style, overflowY: 'hidden', resize: 'none' }}
      {...rest}
    />
  );
}
