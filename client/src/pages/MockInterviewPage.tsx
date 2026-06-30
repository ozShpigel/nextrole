import { useState, useRef, useEffect, type MutableRefObject } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Send, RefreshCw, CheckCircle2, Sparkles, MessageSquare, ArrowLeft, Trash2, Plus, Check, Mic } from 'lucide-react';
import { useMockSessions, useMockSession } from '../lib/queries';
import { useMockTurn, useMockDebrief, useSaveMockSession, useDeleteMockSession, useAdoptRubric } from '../lib/mutations';
import type { MockTurn, MockDebrief, MockPersona, MockLanguage, MockScores, MockSessionListItem } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';

type Phase = 'setup' | 'chat' | 'debrief' | 'review';

const ED_BTN = 'rounded-none border px-3.5 py-[0.5rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;
const ED_DANGER = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10`;

const SCORE_DIMS: { key: keyof MockScores; label: string }[] = [
  { key: 'structure', label: 'מבנה' },
  { key: 'relevance', label: 'רלוונטיות' },
  { key: 'specificity', label: 'קונקרטיות' },
  { key: 'clarity', label: 'בהירות' },
];

function scoreColor(n: number): string {
  if (n >= 4) return 'var(--ed-yes)';
  if (n >= 3) return 'var(--ed-gold)';
  return 'var(--ed-no)';
}

/* ------------------------------------------------------------------ */
/* Sub-section header                                                 */
/* ------------------------------------------------------------------ */
function SectionHeader({ title }: { title: string }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="ed-display italic font-semibold text-[1.4rem] tracking-[-0.01em] text-[var(--ed-ink)]">{title}</span>
      </div>
      <div className="border-t border-[var(--ed-rule-strong)] mb-4" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Score grid                                                         */
/* ------------------------------------------------------------------ */
function ScoreGrid({ scores }: { scores: MockScores }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" dir="rtl">
      {SCORE_DIMS.map(({ key, label }) => {
        const n = scores?.[key] ?? 0;
        return (
          <div key={key} className="border border-[var(--ed-rule)] p-3 bg-[var(--ed-panel)] text-right">
            <div className="text-[0.72rem] text-[var(--ed-ink-faint)] mb-1">{label}</div>
            <div className="ed-display text-[1.4rem] font-bold tabular-nums leading-none" style={{ color: scoreColor(n) }}>
              {n}<span className="text-[0.8rem] text-[var(--ed-ink-faint)] font-normal"> / 5</span>
            </div>
            <div className="mt-2 h-[3px] bg-[var(--ed-rule)] overflow-hidden">
              <div className="h-full" style={{ width: `${(n / 5) * 100}%`, background: scoreColor(n) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Debrief view (used live and in review)                             */
/* ------------------------------------------------------------------ */
function DebriefView({ debrief, onAdopt, adopted }: {
  debrief: MockDebrief;
  onAdopt?: (idx: number, question: string, answer: string) => void;
  adopted?: Record<number, 'pending' | 'done'>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <ScoreGrid scores={debrief.scores} />

      {debrief.highlights?.length > 0 && (
        <div>
          <h4 className="ed-display text-[0.95rem] font-semibold text-[var(--ed-ink)] mb-2 flex items-center gap-[0.4rem]">
            <CheckCircle2 size={15} className="text-[var(--ed-yes)]" /> נקודות חוזק
          </h4>
          <ul className="flex flex-col gap-[0.4rem]">
            {debrief.highlights.map((h, i) => (
              <li key={i} dir="rtl" className="text-[0.86rem] leading-[1.6] text-[var(--ed-ink)] text-right">• {h}</li>
            ))}
          </ul>
        </div>
      )}

      {debrief.improvements?.length > 0 && (
        <div>
          <h4 className="ed-display text-[0.95rem] font-semibold text-[var(--ed-ink)] mb-2 flex items-center gap-[0.4rem]">
            <Sparkles size={15} className="text-[var(--ed-gold)]" /> לשיפור
          </h4>
          <ul className="flex flex-col gap-[0.4rem]">
            {debrief.improvements.map((h, i) => (
              <li key={i} dir="rtl" className="text-[0.86rem] leading-[1.6] text-[var(--ed-ink)] text-right">• {h}</li>
            ))}
          </ul>
        </div>
      )}

      {debrief.rewrites?.length > 0 && (
        <div>
          <h4 className="ed-display text-[0.95rem] font-semibold text-[var(--ed-ink)] mb-2">ניסוחים משופרים</h4>
          <div className="flex flex-col gap-3">
            {debrief.rewrites.map((r, i) => {
              const state = adopted?.[i];
              return (
                <div key={i} className="border border-[var(--ed-rule)] p-[0.9rem_1.1rem] bg-[var(--ed-panel)]">
                  <p dir="rtl" className="text-[0.78rem] text-[var(--ed-ink-faint)] mb-1 text-right font-medium">{r.question}</p>
                  <p dir="rtl" className="text-[0.86rem] leading-[1.7] text-[var(--ed-ink)] text-right whitespace-pre-wrap">{r.suggestedAnswer}</p>
                  {onAdopt && (
                    <div className="flex justify-end mt-2 pt-2 border-t border-dashed border-[var(--ed-rule)]">
                      {state === 'done' ? (
                        <span className="inline-flex items-center gap-[0.35rem] text-[0.74rem] text-[var(--ed-yes)] font-medium">
                          <Check size={13} /> נוסף למאגר השאלות
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`${ED_GHOST} inline-flex items-center gap-[0.35rem]`}
                          disabled={state === 'pending'}
                          onClick={() => onAdopt(i, r.question, r.suggestedAnswer)}
                        >
                          <Plus size={13} /> {state === 'pending' ? 'מוסיף…' : 'אמץ למאגר השאלות'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transcript bubbles                                                 */
/* ------------------------------------------------------------------ */
function Transcript({ turns, dir }: { turns: MockTurn[]; dir: 'rtl' | 'ltr' }) {
  return (
    <div className="flex flex-col gap-4">
      {turns.map((t, i) => (
        <div key={i} className={`flex flex-col ${t.role === 'candidate' ? 'items-start' : 'items-end'}`}>
          <span className="text-[0.66rem] uppercase tracking-[0.14em] text-[var(--ed-ink-faint)] mb-1 px-1">
            {t.role === 'candidate' ? 'אתה' : t.isFollowUp ? 'מראיין · המשך' : 'מראיין'}
          </span>
          <div
            dir={dir}
            className={`max-w-[88%] px-4 py-[0.7rem] text-[0.9rem] leading-[1.7] whitespace-pre-wrap text-[var(--ed-ink)] border ${
              t.role === 'candidate'
                ? 'bg-[var(--ed-panel)] border-[var(--ed-rule)]'
                : 'bg-[var(--ed-panel)] border-l-[3px] border-l-[var(--ed-accent)] border-y-[var(--ed-rule)] border-r-[var(--ed-rule)]'
            }`}
          >
            {t.text}
          </div>
          {t.nudge && (
            <div dir={dir} className="max-w-[88%] mt-1 text-[0.76rem] leading-[1.5] text-[var(--ed-gold)] bg-[var(--ed-gold)]/10 border border-[var(--ed-gold)]/30 px-3 py-[0.4rem]">
              💡 {t.nudge}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Push-to-talk mic (browser Web Speech API)                          */
/* ------------------------------------------------------------------ */
type MicControl = { cancel: () => void };

/* Dictation: click to start, speak, click to stop. The FULL recognized text
   (already-finalized words + the live in-flight tail) is pushed via onText,
   which REPLACES the draft — so the box always mirrors what's been heard and
   nothing is left half-committed. The accumulation survives Chrome's periodic
   auto-restart, and the un-finalized tail is flushed on every session end, so
   long answers aren't clipped. `controlRef.cancel()` lets the send path stop and
   discard cleanly. Uses the browser's built-in recognizer (Chrome/Edge); other
   browsers get a disabled button. */
function MicButton({ language, disabled, onText, getBase, onListeningChange, onError, controlRef }: {
  language: MockLanguage;
  disabled: boolean;
  onText: (text: string) => void;
  getBase: () => string;
  onListeningChange: (listening: boolean) => void;
  onError: (message: string) => void;
  controlRef: MutableRefObject<MicControl | null>;
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

  // Expose an imperative cancel for the send path: stop and discard the
  // accumulation so a late onend can't re-emit the previous answer's text.
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
    if (!SR) { onError('הדפדפן לא תומך בזיהוי דיבור — נסה Chrome או Edge'); return; }
    baseRef.current = getBase();
    committedRef.current = '';
    interimRef.current = '';
    const rec = new SR();
    rec.lang = language === 'he' ? 'he-IL' : 'en-US';
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
        onError('אין הרשאת מיקרופון — אפשר גישה למיקרופון בדפדפן');
        stop();
      } else if (err !== 'no-speech' && err !== 'aborted') {
        // no-speech / aborted are benign (a pause, or our own stop); onend handles them.
        onError('שגיאת זיהוי דיבור: ' + (err ?? 'unknown'));
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
      onError('לא ניתן להפעיל את המיקרופון');
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || !supported}
      title={supported ? (listening ? 'עצור הקלטה' : 'דבר במקום להקליד') : 'זיהוי דיבור לא נתמך בדפדפן זה'}
      aria-label={listening ? 'Stop dictation' : 'Start dictation'}
      onClick={() => (listening ? stop() : start())}
      className={`${listening ? ED_PRIMARY : ED_GHOST} shrink-0 px-2 ${listening ? 'animate-pulse' : ''}`}
    >
      <Mic size={15} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */
export default function MockInterviewPage() {
  const [params] = useSearchParams();
  const applicationId = params.get('applicationId');
  const company = params.get('company');
  const jobTitle = params.get('jobTitle');
  const bound = !!applicationId;

  const [phase, setPhase] = useState<Phase>('setup');
  const [persona, setPersona] = useState<MockPersona>('hr');
  const [language, setLanguage] = useState<MockLanguage>('he');
  const [questionTarget, setQuestionTarget] = useState(6);
  const [transcript, setTranscript] = useState<MockTurn[]>([]);
  const [finished, setFinished] = useState(false);
  const [draft, setDraft] = useState('');
  // `draft` holds the full answer including live dictation. `dictating` locks
  // manual edits while the mic is live; micCtrlRef lets send() cancel cleanly.
  const [dictating, setDictating] = useState(false);
  const micCtrlRef = useRef<MicControl | null>(null);
  const [debriefData, setDebriefData] = useState<MockDebrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [adopted, setAdopted] = useState<Record<number, 'pending' | 'done'>>({});

  const turn = useMockTurn();
  const debrief = useMockDebrief();
  const saveSession = useSaveMockSession();
  const adopt = useAdoptRubric();

  const dir: 'rtl' | 'ltr' = language === 'he' ? 'rtl' : 'ltr';
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript, turn.isPending]);

  function wireTurns(turns: MockTurn[]) {
    return turns.map((t) => ({ role: t.role, text: t.text, nudge: t.nudge, isFollowUp: t.isFollowUp }));
  }

  async function startInterview() {
    setError(null);
    setPhase('chat');
    setTranscript([]);
    setFinished(false);
    setDebriefData(null);
    setAdopted({});
    setDraft('');
    setDictating(false);
    try {
      const res = await turn.mutateAsync({ persona, language, questionTarget, applicationId, transcript: [] });
      setTranscript([{ role: 'interviewer', text: res.nextQuestion, isFollowUp: false }]);
      if (res.done) setFinished(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function sendAnswer() {
    const answer = draft.trim();
    if (!answer || turn.isPending) return;
    // Stop & discard any live dictation so the next question starts clean.
    micCtrlRef.current?.cancel();
    setError(null);
    const withAnswer: MockTurn[] = [...transcript, { role: 'candidate', text: answer }];
    setTranscript(withAnswer);
    setDraft('');
    try {
      const res = await turn.mutateAsync({ persona, language, questionTarget, applicationId, transcript: wireTurns(withAnswer) });
      setTranscript((prev) => {
        const copy = [...prev];
        // Attach the nudge to the candidate answer it refers to (the last one).
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === 'candidate') { copy[i] = { ...copy[i], nudge: res.nudge || copy[i].nudge }; break; }
        }
        if (!res.done && res.nextQuestion) copy.push({ role: 'interviewer', text: res.nextQuestion, isFollowUp: res.isFollowUp });
        return copy;
      });
      if (res.done) setFinished(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function finishAndDebrief() {
    setError(null);
    setPhase('debrief');
    try {
      const d = await debrief.mutateAsync({ persona, language, applicationId, transcript: wireTurns(transcript) });
      setDebriefData(d);
      // Auto-save the completed session (best-effort — a save failure shouldn't
      // hide the debrief the user just earned).
      saveSession.mutate({
        persona, language,
        mode: bound ? 'bound' : 'generic',
        applicationId, company, jobTitle,
        transcript: wireTurns(transcript),
        debrief: d,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function doAdopt(idx: number, question: string, answer: string) {
    setAdopted((p) => ({ ...p, [idx]: 'pending' }));
    try {
      await adopt.mutateAsync({ question, answer });
      setAdopted((p) => ({ ...p, [idx]: 'done' }));
    } catch {
      setAdopted((p) => { const n = { ...p }; delete n[idx]; return n; });
      setError('לא ניתן היה להוסיף למאגר השאלות');
    }
  }

  function reset() {
    micCtrlRef.current?.cancel();
    setPhase('setup');
    setTranscript([]);
    setDebriefData(null);
    setFinished(false);
    setError(null);
    setReviewId(null);
    setAdopted({});
    setDraft('');
    setDictating(false);
  }

  const answersGiven = transcript.filter((t) => t.role === 'candidate').length;

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-12 pb-20 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
        <header className="mb-9">
          <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
            <span>Vol. III · Practice</span>
            <span className="hidden sm:block text-[var(--ed-accent)]">Turn-by-turn rehearsal</span>
          </div>
          <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">ראיון <span className="italic font-medium text-[var(--ed-accent)]">אימון</span></h1>
          <p className="mt-3 max-w-[560px] text-[0.95rem] leading-[1.6] text-[var(--ed-ink-soft)]">
            תרגול ראיון אינטראקטיבי — Claude מראיין אותך שאלה-שאלה, נותן רמזי משוב קצרים, ובסיום מספק סיכום מנוקד עם ניסוחים משופרים.
            {bound && jobTitle && <> מותאם למשרה <span className="font-semibold text-[var(--ed-ink)]">{jobTitle}</span>{company && <> ב־{company}</>}.</>}
          </p>
          <div className="mt-5 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
        </header>

        {error && (
          <div className="mb-6 p-[0.8rem_1.1rem] text-[0.84rem] font-medium border bg-[var(--ed-no)]/10 border-[var(--ed-no)]/30 text-[var(--ed-no)]">
            {error}
          </div>
        )}

        {phase === 'setup' && (
          <SetupView
            persona={persona} setPersona={setPersona}
            language={language} setLanguage={setLanguage}
            questionTarget={questionTarget} setQuestionTarget={setQuestionTarget}
            onStart={startInterview} starting={turn.isPending}
            onReview={(id) => { setReviewId(id); setPhase('review'); }}
          />
        )}

        {phase === 'chat' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[0.78rem] text-[var(--ed-ink-faint)]">
                {persona === 'technical' ? 'ראיון טכני' : 'ראיון HR'} · תשובות: {answersGiven}
              </span>
              <button type="button" className={ED_GHOST} onClick={finishAndDebrief} disabled={answersGiven === 0}>
                סיים וקבל סיכום
              </button>
            </div>

            <Transcript turns={transcript} dir={dir} />

            {turn.isPending && (
              <div className="flex items-center gap-2 text-[0.82rem] text-[var(--ed-ink-faint)] mt-4 justify-end">
                <RefreshCw size={14} className="animate-spin" /> המראיין חושב…
              </div>
            )}

            <div ref={scrollRef} />

            {finished ? (
              <div className="mt-6 border-t border-dashed border-[var(--ed-rule)] pt-5 text-center">
                <p className="text-[0.88rem] text-[var(--ed-ink-soft)] mb-3">הראיון הסתיים. מוכן לסיכום?</p>
                <button type="button" className={`${ED_PRIMARY} inline-flex items-center gap-[0.4rem]`} onClick={finishAndDebrief}><Sparkles size={15} /> קבל סיכום וניתוח</button>
              </div>
            ) : (
              <div className="mt-5 sticky bottom-4">
                <div className="flex items-end gap-2 bg-[var(--ed-panel)] border border-[var(--ed-rule)] p-2">
                  <textarea
                    dir={dir}
                    className="flex-1 bg-transparent resize-none outline-none text-[0.9rem] leading-[1.6] px-2 py-1 max-h-[200px] text-[var(--ed-ink)]"
                    style={{ minHeight: '44px' }}
                    placeholder="הקלד את תשובתך…"
                    value={draft}
                    onChange={(e) => { if (!dictating) setDraft(e.target.value); }}
                    readOnly={dictating}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendAnswer(); } }}
                    disabled={turn.isPending}
                  />
                  <MicButton
                    language={language}
                    disabled={turn.isPending}
                    onText={setDraft}
                    getBase={() => draft}
                    onListeningChange={setDictating}
                    onError={setError}
                    controlRef={micCtrlRef}
                  />
                  <button type="button" className={`${ED_PRIMARY} inline-flex items-center gap-[0.35rem] shrink-0`} onClick={sendAnswer} disabled={!draft.trim() || turn.isPending}>
                    <Send size={14} /> שלח
                  </button>
                </div>
                <p className="text-[0.68rem] text-[var(--ed-ink-faint)] mt-1 px-2 text-center">⌘/Ctrl + Enter לשליחה · 🎤 דבר במקום להקליד</p>
              </div>
            )}
          </div>
        )}

        {phase === 'debrief' && (
          <div>
            <button type="button" className={`${ED_GHOST} inline-flex items-center gap-[0.35rem] mb-4`} onClick={reset}><ArrowLeft size={14} /> ראיון חדש</button>
            {debrief.isPending || !debriefData ? (
              <div className="flex items-center gap-2 text-[0.86rem] text-[var(--ed-ink-faint)] py-10 justify-center">
                <RefreshCw size={16} className="animate-spin" /> מנתח את הראיון ומכין סיכום…
              </div>
            ) : (
              <>
                <DebriefView debrief={debriefData} onAdopt={doAdopt} adopted={adopted} />
                <div className="mt-8 flex justify-center gap-3">
                  <button type="button" className={`${ED_GHOST} inline-flex items-center gap-[0.4rem]`} onClick={reset}><RefreshCw size={14} /> תרגל שוב</button>
                  <Link to="/interview-prep" className={ED_PRIMARY}>חזרה להכנה לראיון</Link>
                </div>
              </>
            )}
          </div>
        )}

        {phase === 'review' && reviewId && (
          <ReviewView sessionId={reviewId} onBack={reset} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */
function SetupView({
  persona, setPersona, language, setLanguage, questionTarget, setQuestionTarget, onStart, starting, onReview,
}: {
  persona: MockPersona; setPersona: (p: MockPersona) => void;
  language: MockLanguage; setLanguage: (l: MockLanguage) => void;
  questionTarget: number; setQuestionTarget: (n: number) => void;
  onStart: () => void; starting: boolean;
  onReview: (id: string) => void;
}) {
  const sessions = useMockSessions();
  const items = (sessions.data ?? []) as MockSessionListItem[];

  return (
    <div className="flex flex-col gap-8">
      <div className="border border-[var(--ed-rule)] p-6">
        <Choice
          label="סוג הראיון"
          options={[{ v: 'hr', l: 'ראיון HR / מגייס' }, { v: 'technical', l: 'ראיון טכני' }]}
          value={persona}
          onChange={(v) => setPersona(v as MockPersona)}
        />
        <Choice
          label="שפת הראיון"
          options={[{ v: 'he', l: 'עברית' }, { v: 'en', l: 'English' }]}
          value={language}
          onChange={(v) => setLanguage(v as MockLanguage)}
        />
        <div className="mb-1">
          <div className="text-[0.7rem] text-[var(--ed-ink-faint)] tracking-[0.14em] uppercase font-semibold mb-2">מספר שאלות</div>
          <div className="inline-flex border border-[var(--ed-rule)] overflow-hidden">
            {[4, 6, 8, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setQuestionTarget(n)}
                className={`px-4 py-[0.4rem] text-[0.82rem] font-medium transition-colors tabular-nums ${questionTarget === n ? 'bg-[var(--ed-accent)] text-[var(--ed-paper)]' : 'bg-transparent text-[var(--ed-ink-soft)] hover:text-[var(--ed-ink)]'}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-6 pt-5 border-t border-dashed border-[var(--ed-rule)] flex justify-end">
          <button type="button" className={`${ED_PRIMARY} inline-flex items-center gap-[0.45rem] px-5 py-[0.6rem] text-[0.74rem]`} onClick={onStart} disabled={starting}>
            {starting ? <><RefreshCw size={15} className="animate-spin" /> מתחיל…</> : <><MessageSquare size={15} /> התחל ראיון</>}
          </button>
        </div>
      </div>

      {/* Past sessions */}
      <div>
        <SectionHeader title="היסטוריית ראיונות" />
        {sessions.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : items.length === 0 ? (
          <p className="text-[0.82rem] text-[var(--ed-ink-faint)] italic">עוד לא תרגלת ראיון. ראיון שתסיים יישמר כאן לצורך מעקב והשוואה.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((s) => <SessionRow key={s.id} s={s} onReview={onReview} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Choice({ label, options, value, onChange }: { label: string; options: { v: string; l: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="mb-5">
      <div className="text-[0.7rem] text-[var(--ed-ink-faint)] tracking-[0.14em] uppercase font-semibold mb-2">{label}</div>
      <div className="inline-flex border border-[var(--ed-rule)] overflow-hidden flex-wrap">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`px-4 py-[0.4rem] text-[0.82rem] font-medium transition-colors ${value === o.v ? 'bg-[var(--ed-accent)] text-[var(--ed-paper)]' : 'bg-transparent text-[var(--ed-ink-soft)] hover:text-[var(--ed-ink)]'}`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

function avgScore(s?: MockScores | null): number | null {
  if (!s) return null;
  const vals = [s.structure, s.relevance, s.specificity, s.clarity];
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function SessionRow({ s, onReview }: { s: MockSessionListItem; onReview: (id: string) => void }) {
  const del = useDeleteMockSession();
  const avg = avgScore(s.scores);
  const when = new Date(s.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
  return (
    <div className="flex items-center justify-between gap-3 border border-[var(--ed-rule)] p-[0.7rem_1rem] bg-[var(--ed-panel)] hover:border-[var(--ed-ink)]/40 transition-colors">
      <button type="button" onClick={() => onReview(s.id)} className="flex-1 text-right min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[0.84rem] font-medium text-[var(--ed-ink)]">{s.persona === 'technical' ? 'טכני' : 'HR'}</span>
          {s.jobTitle && <span className="text-[0.78rem] text-[var(--ed-ink-faint)] truncate">· {s.jobTitle}</span>}
          <span className="text-[0.72rem] text-[var(--ed-ink-faint)]">· {when}</span>
        </div>
      </button>
      {avg !== null && (
        <span className="ed-display text-[0.82rem] font-bold tabular-nums shrink-0" style={{ color: scoreColor(avg) }}>{avg} / 5</span>
      )}
      <button type="button" className={`${ED_DANGER} h-7 w-7 p-0 inline-flex items-center justify-center shrink-0`} aria-label="מחק" onClick={() => del.mutate(s.id)}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Review                                                             */
/* ------------------------------------------------------------------ */
function ReviewView({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const q = useMockSession(sessionId, true);
  const dir: 'rtl' | 'ltr' = q.data?.language === 'en' ? 'ltr' : 'rtl';

  return (
    <div>
      <button type="button" className={`${ED_GHOST} inline-flex items-center gap-[0.35rem] mb-4`} onClick={onBack}><ArrowLeft size={14} /> חזרה</button>
      {q.isLoading || !q.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-col gap-8">
          {q.data.debrief && <DebriefView debrief={q.data.debrief} />}
          <div>
            <SectionHeader title="תמלול הראיון" />
            <Transcript turns={q.data.turns} dir={dir} />
          </div>
        </div>
      )}
    </div>
  );
}
