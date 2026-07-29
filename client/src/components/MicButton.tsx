import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Mic } from 'lucide-react';

export type MicControl = { cancel: () => void };

const BASE_BTN = 'rounded-full border px-2 shrink-0 h-9 inline-flex items-center justify-center transition-all disabled:opacity-50 disabled:pointer-events-none';
// 'editorial' = --ed-* tokens, for pages inside the .editorial subtree (e.g.
// Mock Interview's composer). 'neutral' = shadcn semantic tokens, for
// portal-rendered dialogs (shadcn Dialog mounts outside .editorial — see
// docs/design-system.md's portal caveat).
const VARIANT_CLASS = {
  editorial: {
    idle: `${BASE_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`,
    listening: `${BASE_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] animate-pulse`,
  },
  neutral: {
    idle: `${BASE_BTN} border-border text-muted-foreground hover:border-foreground hover:text-foreground`,
    listening: `${BASE_BTN} border-primary bg-primary text-primary-foreground animate-pulse`,
  },
};

/* Push-to-talk mic (browser Web Speech API). Click to start, speak, click to
 * stop. The FULL recognized text (already-finalized words + the live
 * in-flight tail) is pushed via onText, which REPLACES the draft — so the box
 * always mirrors what's been heard and nothing is left half-committed. The
 * accumulation survives Chrome's periodic auto-restart, and the un-finalized
 * tail is flushed on every session end, so long answers aren't clipped.
 * `controlRef.cancel()` lets the caller stop and discard cleanly. Uses the
 * browser's built-in recognizer (Chrome/Edge); other browsers get a disabled
 * button. */
export function MicButton({ lang, disabled, onText, getBase, onListeningChange, onError, controlRef, variant = 'editorial' }: {
  lang: string; // BCP-47, e.g. 'he-IL' | 'en-US'
  disabled: boolean;
  onText: (text: string) => void;
  getBase: () => string;
  onListeningChange: (listening: boolean) => void;
  onError: (message: string) => void;
  controlRef: MutableRefObject<MicControl | null>;
  variant?: 'editorial' | 'neutral';
}) {
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const wantListeningRef = useRef(false); // user still intends to dictate
  const baseRef = useRef('');             // text present before dictation began
  const committedRef = useRef('');        // finalized dictation, this span
  const interimRef = useRef('');          // current un-finalized words
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;
  const supported = !!SR;

  // The complete text to show: typed base + everything dictated so far.
  function buildFull(): string {
    const dictated = `${committedRef.current} ${interimRef.current}`.trim().replace(/\s+/g, ' ');
    const base = baseRef.current;
    if (!dictated) return base;
    return base ? `${base.replace(/\s+$/, '')} ${dictated}` : dictated;
  }

  // Stop recognition if the component unmounts mid-listen.
  useEffect(() => () => { wantListeningRef.current = false; try { recRef.current?.stop(); } catch { /* ignore */ } }, []);

  // Let the parent lock the textarea while the mic is live.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onListeningChange(listening); }, [listening]);

  // Expose an imperative cancel for the caller: stop and discard the
  // accumulation so a late onend can't re-emit the previous text.
  function cancel() {
    wantListeningRef.current = false;
    const rec = recRef.current;
    recRef.current = null; // makes any late onresult/onend a no-op (guarded below)
    baseRef.current = committedRef.current = interimRef.current = '';
    try { rec?.stop(); } catch { /* ignore */ }
    setListening(false);
  }
  useEffect(() => {
    controlRef.current = { cancel };
    return () => { controlRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop() {
    wantListeningRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    // onend finalizes the tail, emits the full text, and flips listening off.
  }

  function start() {
    if (!SR) { onError('Speech recognition is not supported in this browser — try Chrome or Edge'); return; }
    baseRef.current = getBase();
    committedRef.current = '';
    interimRef.current = '';
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      if (recRef.current !== rec) return; // ignore events after cancel()
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const seg: string = e.results[i][0].transcript ?? '';
        if (e.results[i].isFinal) {
          const s = seg.trim();
          if (s) committedRef.current = committedRef.current ? `${committedRef.current} ${s}` : s;
        } else {
          interimText += seg;
        }
      }
      interimRef.current = interimText.trim();
      onText(buildFull());
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      const err = e?.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        onError('No microphone permission — allow microphone access in your browser');
        stop();
      } else if (err !== 'no-speech' && err !== 'aborted') {
        // no-speech / aborted are benign (a pause, or our own stop); onend handles them.
        onError('Speech recognition error: ' + (err ?? 'unknown'));
        stop();
      }
    };
    // Chrome ends recognition periodically (on silence / after a long utterance)
    // even with continuous=true. Flush the un-finalized tail into committed so a
    // restart never drops it, then restart while the user is still dictating.
    rec.onend = () => {
      if (recRef.current !== rec) return; // canceled
      if (interimRef.current) {
        committedRef.current = committedRef.current ? `${committedRef.current} ${interimRef.current}` : interimRef.current;
        interimRef.current = '';
      }
      onText(buildFull());
      if (wantListeningRef.current) {
        try { rec.start(); } catch { wantListeningRef.current = false; setListening(false); }
      } else {
        setListening(false);
      }
    };
    // Register before start() so the guards above accept the first events.
    recRef.current = rec;
    wantListeningRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      wantListeningRef.current = false;
      onError('Could not start the microphone');
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || !supported}
      title={supported ? (listening ? 'Stop recording' : 'Speak instead of typing') : 'Speech recognition not supported in this browser'}
      aria-label={listening ? 'Stop dictation' : 'Start dictation'}
      onClick={() => (listening ? stop() : start())}
      className={listening ? VARIANT_CLASS[variant].listening : VARIANT_CLASS[variant].idle}
    >
      <Mic size={15} />
    </button>
  );
}
