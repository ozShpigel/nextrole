import { useState, useRef, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Send, RefreshCw, CheckCircle2, Sparkles, MessageSquare, ArrowLeft, Trash2, Plus, Check, Mic } from 'lucide-react';
import { useMockSessions, useMockSession } from '../lib/queries';
import { useMockTurn, useMockDebrief, useSaveMockSession, useDeleteMockSession, useAdoptRubric } from '../lib/mutations';
import type { MockTurn, MockDebrief, MockPersona, MockLanguage, MockScores, MockSessionListItem } from '../lib/types';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';

type Phase = 'setup' | 'chat' | 'debrief' | 'review';

const SCORE_DIMS: { key: keyof MockScores; label: string }[] = [
  { key: 'structure', label: 'מבנה' },
  { key: 'relevance', label: 'רלוונטיות' },
  { key: 'specificity', label: 'קונקרטיות' },
  { key: 'clarity', label: 'בהירות' },
];

function scoreColor(n: number): string {
  if (n >= 4) return '#059669';
  if (n >= 3) return '#d97706';
  return '#ef4444';
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
          <div key={key} className="border border-border rounded-lg p-3 bg-card text-right">
            <div className="text-[0.72rem] text-muted-foreground mb-1">{label}</div>
            <div className="text-[1.4rem] font-bold tabular-nums leading-none" style={{ color: scoreColor(n) }}>
              {n}<span className="text-[0.8rem] text-muted-foreground font-normal"> / 5</span>
            </div>
            <div className="mt-2 h-[3px] rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(n / 5) * 100}%`, background: scoreColor(n) }} />
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
          <h4 className="text-[0.82rem] font-semibold text-foreground mb-2 flex items-center gap-[0.4rem]">
            <CheckCircle2 size={15} className="text-emerald-600" /> נקודות חוזק
          </h4>
          <ul className="flex flex-col gap-[0.4rem]">
            {debrief.highlights.map((h, i) => (
              <li key={i} dir="rtl" className="text-[0.86rem] leading-[1.6] text-foreground text-right">• {h}</li>
            ))}
          </ul>
        </div>
      )}

      {debrief.improvements?.length > 0 && (
        <div>
          <h4 className="text-[0.82rem] font-semibold text-foreground mb-2 flex items-center gap-[0.4rem]">
            <Sparkles size={15} className="text-amber-600" /> לשיפור
          </h4>
          <ul className="flex flex-col gap-[0.4rem]">
            {debrief.improvements.map((h, i) => (
              <li key={i} dir="rtl" className="text-[0.86rem] leading-[1.6] text-foreground text-right">• {h}</li>
            ))}
          </ul>
        </div>
      )}

      {debrief.rewrites?.length > 0 && (
        <div>
          <h4 className="text-[0.82rem] font-semibold text-foreground mb-2">ניסוחים משופרים</h4>
          <div className="flex flex-col gap-3">
            {debrief.rewrites.map((r, i) => {
              const state = adopted?.[i];
              return (
                <div key={i} className="border border-border rounded-lg p-[0.9rem_1.1rem] bg-card">
                  <p dir="rtl" className="text-[0.78rem] text-muted-foreground mb-1 text-right font-medium">{r.question}</p>
                  <p dir="rtl" className="text-[0.86rem] leading-[1.7] text-foreground text-right whitespace-pre-wrap">{r.suggestedAnswer}</p>
                  {onAdopt && (
                    <div className="flex justify-end mt-2 pt-2 border-t border-dashed border-border">
                      {state === 'done' ? (
                        <span className="inline-flex items-center gap-[0.35rem] text-[0.74rem] text-emerald-600 font-medium">
                          <Check size={13} /> נוסף למאגר השאלות
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={state === 'pending'}
                          onClick={() => onAdopt(i, r.question, r.suggestedAnswer)}
                          className="gap-[0.35rem]"
                        >
                          <Plus size={13} /> {state === 'pending' ? 'מוסיף…' : 'אמץ למאגר השאלות'}
                        </Button>
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
          <span className="text-[0.66rem] uppercase tracking-[0.14em] text-muted-foreground mb-1 px-1">
            {t.role === 'candidate' ? 'אתה' : t.isFollowUp ? 'מראיין · המשך' : 'מראיין'}
          </span>
          <div
            dir={dir}
            className={`max-w-[88%] rounded-2xl px-4 py-[0.7rem] text-[0.9rem] leading-[1.7] whitespace-pre-wrap ${
              t.role === 'candidate'
                ? 'bg-muted text-foreground rounded-bl-sm'
                : 'bg-primary/10 text-foreground rounded-br-sm border border-primary/15'
            }`}
          >
            {t.text}
          </div>
          {t.nudge && (
            <div dir={dir} className="max-w-[88%] mt-1 text-[0.76rem] leading-[1.5] text-amber-700 bg-amber-50/60 border border-amber-200/50 rounded-lg px-3 py-[0.4rem]">
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
/* Toggle dictation: click to start, speak, click to stop. Recognized
   final text is appended to the answer via onText; the user still edits
   and sends. Uses the browser's built-in recognizer (Chrome/Edge) — no
   backend, no cost. Unsupported browsers (Firefox) get a disabled button. */
function MicButton({ language, disabled, onText, onError }: {
  language: MockLanguage;
  disabled: boolean;
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;
  const supported = !!SR;

  // Stop recognition if the component unmounts mid-listen.
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* ignore */ } }, []);

  function stop() {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    recRef.current = null;
    setListening(false);
  }

  function start() {
    if (!SR) { onError('הדפדפן לא תומך בזיהוי דיבור — נסה Chrome או Edge'); return; }
    const rec = new SR();
    rec.lang = language === 'he' ? 'he-IL' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      const trimmed = finalText.trim();
      if (trimmed) onText(trimmed);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed')
        onError('אין הרשאת מיקרופון — אפשר גישה למיקרופון בדפדפן');
      else if (e?.error !== 'aborted' && e?.error !== 'no-speech')
        onError('שגיאת זיהוי דיבור: ' + (e?.error ?? 'unknown'));
      stop();
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      onError('לא ניתן להפעיל את המיקרופון');
    }
  }

  return (
    <Button
      type="button"
      variant={listening ? 'default' : 'outline'}
      size="sm"
      disabled={disabled || !supported}
      title={supported ? (listening ? 'עצור הקלטה' : 'דבר במקום להקליד') : 'זיהוי דיבור לא נתמך בדפדפן זה'}
      aria-label={listening ? 'Stop dictation' : 'Start dictation'}
      onClick={() => (listening ? stop() : start())}
      className={`shrink-0 px-2 ${listening ? 'animate-pulse' : ''}`}
    >
      <Mic size={15} className={listening ? 'text-destructive' : ''} />
    </Button>
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
    setPhase('setup');
    setTranscript([]);
    setDebriefData(null);
    setFinished(false);
    setError(null);
    setReviewId(null);
    setAdopted({});
  }

  const answersGiven = transcript.filter((t) => t.role === 'candidate').length;

  return (
    <div className="relative max-w-[820px] mx-auto px-7 pt-16 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 max-sm:px-4 max-sm:pt-10 max-sm:pb-14">
      <header className="mb-10 relative py-[0.4rem]">
        <span className="inline-flex items-center gap-[0.55rem] font-mono text-[0.66rem] tracking-[0.3em] uppercase text-muted-foreground font-medium py-[0.32rem] pr-[0.95rem] pl-[0.7rem] border border-border rounded-full bg-muted/30 mb-[1.35rem]">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shadow-[0_0_0_3px_rgba(0,0,0,0.06)] shrink-0" />
          Practice Interview
        </span>
        <h1 className="font-serif text-[clamp(2rem,4.2vw,2.8rem)] font-bold text-foreground leading-[1.05] mb-3 tracking-[-0.018em]">ראיון אימון</h1>
        <p className="text-muted-foreground text-[0.96rem] max-w-[600px] leading-[1.65]">
          תרגול ראיון אינטראקטיבי — Claude מראיין אותך שאלה-שאלה, נותן רמזי משוב קצרים, ובסיום מספק סיכום מנוקד עם ניסוחים משופרים.
          {bound && jobTitle && <> מותאם למשרה <span className="font-semibold text-foreground">{jobTitle}</span>{company && <> ב־{company}</>}.</>}
        </p>
      </header>

      {error && (
        <div className="mb-6 p-[0.8rem_1.1rem] rounded text-[0.84rem] font-medium border bg-red-50/70 border-red-200/50 text-red-700">
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
            <span className="text-[0.78rem] text-muted-foreground">
              {persona === 'technical' ? 'ראיון טכני' : 'ראיון HR'} · תשובות: {answersGiven}
            </span>
            <Button variant="outline" size="sm" onClick={finishAndDebrief} disabled={answersGiven === 0}>
              סיים וקבל סיכום
            </Button>
          </div>

          <Transcript turns={transcript} dir={dir} />

          {turn.isPending && (
            <div className="flex items-center gap-2 text-[0.82rem] text-muted-foreground mt-4 justify-end">
              <RefreshCw size={14} className="animate-spin" /> המראיין חושב…
            </div>
          )}

          <div ref={scrollRef} />

          {finished ? (
            <div className="mt-6 border-t border-dashed border-border pt-5 text-center">
              <p className="text-[0.88rem] text-muted-foreground mb-3">הראיון הסתיים. מוכן לסיכום?</p>
              <Button onClick={finishAndDebrief} className="gap-[0.4rem]"><Sparkles size={15} /> קבל סיכום וניתוח</Button>
            </div>
          ) : (
            <div className="mt-5 sticky bottom-4">
              <div className="flex items-end gap-2 bg-card border border-border rounded-xl p-2 shadow-sm">
                <textarea
                  dir={dir}
                  className="flex-1 bg-transparent resize-none outline-none text-[0.9rem] leading-[1.6] px-2 py-1 max-h-[200px] text-foreground"
                  style={{ minHeight: '44px' }}
                  placeholder="הקלד את תשובתך…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendAnswer(); } }}
                  disabled={turn.isPending}
                />
                <MicButton
                  language={language}
                  disabled={turn.isPending}
                  onText={(t) => setDraft((d) => (d ? d + ' ' : '') + t)}
                  onError={setError}
                />
                <Button onClick={sendAnswer} disabled={!draft.trim() || turn.isPending} size="sm" className="gap-[0.35rem] shrink-0">
                  <Send size={14} /> שלח
                </Button>
              </div>
              <p className="text-[0.68rem] text-muted-foreground mt-1 px-2 text-center">⌘/Ctrl + Enter לשליחה · 🎤 דבר במקום להקליד</p>
            </div>
          )}
        </div>
      )}

      {phase === 'debrief' && (
        <div>
          <Button variant="ghost" size="sm" onClick={reset} className="mb-4 gap-[0.35rem]"><ArrowLeft size={14} /> ראיון חדש</Button>
          {debrief.isPending || !debriefData ? (
            <div className="flex items-center gap-2 text-[0.86rem] text-muted-foreground py-10 justify-center">
              <RefreshCw size={16} className="animate-spin" /> מנתח את הראיון ומכין סיכום…
            </div>
          ) : (
            <>
              <DebriefView debrief={debriefData} onAdopt={doAdopt} adopted={adopted} />
              <div className="mt-8 flex justify-center gap-3">
                <Button onClick={reset} variant="outline" className="gap-[0.4rem]"><RefreshCw size={14} /> תרגל שוב</Button>
                <Button asChild><Link to="/interview-prep">חזרה להכנה לראיון</Link></Button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'review' && reviewId && (
        <ReviewView sessionId={reviewId} onBack={reset} />
      )}
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
      <div className="border border-border rounded-xl p-6 bg-card">
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
          <div className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold mb-2">מספר שאלות</div>
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {[4, 6, 8, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setQuestionTarget(n)}
                className={`px-4 py-[0.4rem] text-[0.82rem] font-medium transition-colors tabular-nums ${questionTarget === n ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-6 pt-5 border-t border-dashed border-border flex justify-end">
          <Button onClick={onStart} disabled={starting} size="lg" className="gap-[0.45rem]">
            {starting ? <><RefreshCw size={15} className="animate-spin" /> מתחיל…</> : <><MessageSquare size={15} /> התחל ראיון</>}
          </Button>
        </div>
      </div>

      {/* Past sessions */}
      <div>
        <h3 className="text-[0.82rem] font-semibold text-foreground mb-3 flex items-center gap-[0.4rem]">היסטוריית ראיונות</h3>
        {sessions.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : items.length === 0 ? (
          <p className="text-[0.82rem] text-muted-foreground italic">עוד לא תרגלת ראיון. ראיון שתסיים יישמר כאן לצורך מעקב והשוואה.</p>
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
      <div className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold mb-2">{label}</div>
      <div className="inline-flex rounded-md border border-border overflow-hidden flex-wrap">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`px-4 py-[0.4rem] text-[0.82rem] font-medium transition-colors ${value === o.v ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
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
    <div className="flex items-center justify-between gap-3 border border-border rounded-lg p-[0.7rem_1rem] bg-card hover:border-muted-foreground/30 transition-colors">
      <button type="button" onClick={() => onReview(s.id)} className="flex-1 text-right min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[0.84rem] font-medium text-foreground">{s.persona === 'technical' ? 'טכני' : 'HR'}</span>
          {s.jobTitle && <span className="text-[0.78rem] text-muted-foreground truncate">· {s.jobTitle}</span>}
          <span className="text-[0.72rem] text-muted-foreground">· {when}</span>
        </div>
      </button>
      {avg !== null && (
        <span className="text-[0.82rem] font-bold tabular-nums shrink-0" style={{ color: scoreColor(avg) }}>{avg} / 5</span>
      )}
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0" aria-label="מחק" onClick={() => del.mutate(s.id)}>
        <Trash2 size={14} />
      </Button>
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
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-4 gap-[0.35rem]"><ArrowLeft size={14} /> חזרה</Button>
      {q.isLoading || !q.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-col gap-8">
          {q.data.debrief && <DebriefView debrief={q.data.debrief} />}
          <div>
            <h4 className="text-[0.82rem] font-semibold text-foreground mb-3">תמלול הראיון</h4>
            <Transcript turns={q.data.turns} dir={dir} />
          </div>
        </div>
      )}
    </div>
  );
}
