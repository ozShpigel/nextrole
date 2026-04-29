import { useState, useEffect, useRef, useMemo } from 'react';
import { profileApi } from '../../utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Separator } from '../../components/ui/separator';

const MODEL_OPTIONS = [
  'claude-sonnet-4-6',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
];

const DEFAULT_ROLE_CONFIG = {
  model: 'claude-sonnet-4-6',
  temperature: 0.5,
  max_tokens: 4096,
  thinking_enabled: false,
  thinking_budget: 2048,
};

const DEFAULT_CONFIG = {
  analyst: {
    ...DEFAULT_ROLE_CONFIG,
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.3,
    max_tokens: 2048,
  },
  evaluator: { ...DEFAULT_ROLE_CONFIG },
  min_score_to_save: 70,
};

function mergeScoringConfig(incoming) {
  const sc = incoming || {};
  // Legacy flat shape → map flat keys onto the Evaluator role (that was the
  // only call that actually honored them). Analyst falls back to defaults.
  const hasNested = sc.analyst || sc.evaluator;
  const evaluatorSource = hasNested ? (sc.evaluator || {}) : sc;
  return {
    analyst: { ...DEFAULT_CONFIG.analyst, ...(sc.analyst || {}) },
    evaluator: { ...DEFAULT_CONFIG.evaluator, ...evaluatorSource },
    min_score_to_save: sc.min_score_to_save ?? DEFAULT_CONFIG.min_score_to_save,
  };
}

const EVALUATOR_PLACEHOLDERS = ['{{USER_PROFILE}}', '{{PARSED_JOB}}'];

const estimateTokens = (text) => Math.ceil((text?.length || 0) / 4);

const detectHeadings = (text) => {
  if (!text) return [];
  const out = [];
  const re = /^(#+)\s+(.+)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ level: m[1].length, text: m[2].trim(), offset: m.index });
  }
  return out;
};

const placeholderStatus = (text, placeholders) =>
  placeholders.map((p) => ({ token: p, present: (text || '').includes(p) }));

function scrollTextareaToOffset(ta, offset) {
  if (!ta || offset == null) return;
  const before = ta.value.slice(0, offset);
  const line = before.split('\n').length - 1;
  const cs = window.getComputedStyle(ta);
  const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.75);
  const paddingTop = parseFloat(cs.paddingTop) || 0;
  ta.scrollTop = Math.max(0, line * lineHeight - paddingTop);
  ta.focus();
  // place caret at the heading start for further editing
  try { ta.setSelectionRange(offset, offset); } catch { /* ignore */ }
}

const SECTIONS = [
  { id: 'settings-section-01', num: '01', name: 'פרופיל מקצועי', short: 'Profile' },
  { id: 'settings-section-02', num: '02', name: 'פרומפט אנליסט', short: 'Analyst' },
  { id: 'settings-section-03', num: '03', name: 'פרומפט הערכה', short: 'Evaluator' },
  { id: 'settings-section-04', num: '04', name: 'תצורת ניתוח', short: 'Tuning' },
  { id: 'settings-section-05', num: '05', name: 'מבנה ניתוח', short: 'Scoring' },
];

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const nav = document.querySelector('[data-app-nav]');
  const navH = nav ? nav.getBoundingClientRect().height : 0;
  const y = el.getBoundingClientRect().top + window.pageYOffset - navH - 24;
  window.scrollTo({ top: y, behavior: 'smooth' });
}

export default function SettingsPage() {
  const [profile, setProfile] = useState('');
  const [originalProfile, setOriginalProfile] = useState('');
  const [analystPrompt, setAnalystPrompt] = useState('');
  const [originalAnalystPrompt, setOriginalAnalystPrompt] = useState('');
  const [evaluatorPrompt, setEvaluatorPrompt] = useState('');
  const [originalEvaluatorPrompt, setOriginalEvaluatorPrompt] = useState('');
  const [analystIsOverride, setAnalystIsOverride] = useState(false);
  const [evaluatorIsOverride, setEvaluatorIsOverride] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState(DEFAULT_CONFIG);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAnalyst, setSavingAnalyst] = useState(false);
  const [savingEvaluator, setSavingEvaluator] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const [profileResult, setProfileResult] = useState(null);
  const [analystResult, setAnalystResult] = useState(null);
  const [evaluatorResult, setEvaluatorResult] = useState(null);
  const [configResult, setConfigResult] = useState(null);

  // UI-only confirmation state
  const [confirmReset, setConfirmReset] = useState(null); // 'analyst' | 'evaluator' | null
  const [confirmUnsafeSave, setConfirmUnsafeSave] = useState(false);

  useEffect(() => { load(); }, []);

  // Scrollspy — track which section the reader is currently on. Top-band
  // activation zone so a section "wins" as soon as its heading crosses the
  // upper third of the viewport, not when the section is centered.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: '-18% 0px -70% 0px', threshold: 0 },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [loading]);

  async function load() {
    try {
      const data = await profileApi('/profile');
      const content = data?.content || '';
      setProfile(content);
      setOriginalProfile(content);

      const analyst = data?.analyst_prompt || '';
      setAnalystPrompt(analyst);
      setOriginalAnalystPrompt(analyst);
      setAnalystIsOverride(!!data?.analyst_prompt_is_override);

      const evaluator = data?.evaluator_prompt || '';
      setEvaluatorPrompt(evaluator);
      setOriginalEvaluatorPrompt(evaluator);
      setEvaluatorIsOverride(!!data?.evaluator_prompt_is_override);

      setLastUpdated(data?.updated_at);
      if (data?.scoring_config) {
        const merged = mergeScoringConfig(data.scoring_config);
        setConfig(merged);
        setOriginalConfig(merged);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const isProfileDirty = profile !== originalProfile;
  const isAnalystDirty = analystPrompt !== originalAnalystPrompt;
  const isEvaluatorDirty = evaluatorPrompt !== originalEvaluatorPrompt;
  const isConfigDirty = JSON.stringify(config) !== JSON.stringify(originalConfig);

  async function saveField(body, setSaving, setResult, onSuccess, label) {
    setSaving(true);
    setResult(null);
    try {
      const data = await profileApi('/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setLastUpdated(data?.updated_at);
      if (data?.analyst_prompt_is_override !== undefined) setAnalystIsOverride(!!data.analyst_prompt_is_override);
      if (data?.evaluator_prompt_is_override !== undefined) setEvaluatorIsOverride(!!data.evaluator_prompt_is_override);
      onSuccess(data);
      setResult({ type: 'success', message: `${label} נשמר בהצלחה` });
    } catch (e) {
      setResult({ type: 'error', message: `שגיאה בשמירה: ${e.message}` });
    } finally {
      setSaving(false);
    }
  }

  const saveProfile = () => saveField(
    { content: profile },
    setSavingProfile, setProfileResult,
    () => setOriginalProfile(profile),
    'הפרופיל',
  );

  const saveAnalyst = () => saveField(
    { analyst_prompt: analystPrompt },
    setSavingAnalyst, setAnalystResult,
    (data) => {
      const v = data?.analyst_prompt || '';
      setAnalystPrompt(v);
      setOriginalAnalystPrompt(v);
    },
    'פרומפט האנליסט',
  );

  const saveEvaluator = () => saveField(
    { evaluator_prompt: evaluatorPrompt },
    setSavingEvaluator, setEvaluatorResult,
    (data) => {
      const v = data?.evaluator_prompt || '';
      setEvaluatorPrompt(v);
      setOriginalEvaluatorPrompt(v);
      setConfirmUnsafeSave(false);
    },
    'פרומפט ההערכה',
  );

  const saveConfig = () => saveField(
    { scoring_config: config },
    setSavingConfig, setConfigResult,
    (data) => {
      if (data?.scoring_config) {
        const merged = mergeScoringConfig(data.scoring_config);
        setConfig(merged);
        setOriginalConfig(merged);
      }
    },
    'תצורת הניתוח',
  );

  function confirmResetAccept() {
    if (confirmReset === 'analyst') {
      saveField(
        { analyst_prompt: '' },
        setSavingAnalyst, setAnalystResult,
        (data) => {
          const v = data?.analyst_prompt || '';
          setAnalystPrompt(v);
          setOriginalAnalystPrompt(v);
        },
        'פרומפט האנליסט אופס',
      );
    } else if (confirmReset === 'evaluator') {
      saveField(
        { evaluator_prompt: '' },
        setSavingEvaluator, setEvaluatorResult,
        (data) => {
          const v = data?.evaluator_prompt || '';
          setEvaluatorPrompt(v);
          setOriginalEvaluatorPrompt(v);
        },
        'פרומפט ההערכה אופס',
      );
    }
    setConfirmReset(null);
  }

  // path: 'analyst.model' | 'evaluator.temperature' | 'min_score_to_save'
  function updateConfig(path, value) {
    setConfig(prev => {
      if (!path.includes('.')) return { ...prev, [path]: value };
      const [role, key] = path.split('.');
      return { ...prev, [role]: { ...prev[role], [key]: value } };
    });
    setConfigResult(null);
  }

  const evaluatorPlaceholderStates = useMemo(
    () => placeholderStatus(evaluatorPrompt, EVALUATOR_PLACEHOLDERS),
    [evaluatorPrompt],
  );
  const evaluatorMissingPlaceholder = evaluatorPlaceholderStates.some((p) => !p.present);

  function handleEvaluatorSaveClick() {
    if (evaluatorMissingPlaceholder && !confirmUnsafeSave) {
      setConfirmUnsafeSave(true);
      return;
    }
    saveEvaluator();
  }

  const dirtyMap = {
    '01': isProfileDirty,
    '02': isAnalystDirty,
    '03': isEvaluatorDirty,
    '04': isConfigDirty,
    '05': false,
  };
  const dirtyList = SECTIONS.filter((s) => dirtyMap[s.num]);

  if (loading) return <SettingsLoadingSkeleton />;

  return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-16 pb-32 animate-page-in isolate max-sm:px-4 max-sm:pt-10 max-sm:pb-14">
      <FolioRail activeId={activeSection} dirtyMap={dirtyMap} />
      <UnsavedDock dirtyList={dirtyList} />

      <header className="mb-14 relative py-[0.4rem]">
        <span className="inline-flex items-center gap-[0.55rem] font-mono text-[0.66rem] tracking-[0.3em] uppercase text-muted-foreground font-medium py-[0.32rem] pe-[0.95rem] ps-[0.7rem] border border-border rounded-full bg-muted/30 mb-[1.35rem]">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shadow-[0_0_0_3px_rgba(0,0,0,0.06)] shrink-0" />
          Configuration · 2026
        </span>
        <h1 className="font-serif text-[clamp(2.2rem,4.6vw,3.1rem)] font-bold text-foreground leading-[1.05] mb-3 tracking-[-0.018em]">הגדרות</h1>
        <p className="text-muted-foreground text-[0.98rem] max-w-[560px] leading-[1.65]">
          צפייה ועריכה של נתוני הקלט לניתוח Claude — הפרופיל המקצועי, הפרומפטים ופרמטרי המודל.
        </p>
        <div className="mt-8 h-px relative" style={{ background: 'linear-gradient(to left, transparent 0%, oklch(0.7 0 0 / 0.3) 50%, transparent 100%)' }}>
          <span
            className="absolute top-1/2 right-1/2 translate-x-1/2 -translate-y-1/2 font-serif text-[0.9rem] text-muted-foreground bg-background px-3 opacity-75"
          >
            §
          </span>
        </div>
      </header>

      {error && (
        <div className="bg-destructive/5 border border-destructive/15 py-[0.85rem] px-[1.15rem] rounded mb-8 text-destructive text-[0.85rem]">
          {error}
        </div>
      )}

      {/* 01 — Profile Editor */}
      <section className="mb-16 relative animate-section-in" id="settings-section-01">
        <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border relative">
          <span className="absolute bottom-[-1px] start-0 w-11 h-0.5 bg-gradient-to-r from-muted-foreground to-transparent rounded-sm" />
          <span className="font-serif text-[2.4rem] font-bold text-muted-foreground tracking-[-0.03em] tabular-nums leading-[0.85] shrink-0 min-w-[2.6ch] ltr relative group">
            <span className="absolute bottom-[0.35em] left-0 w-[0.55em] h-0.5 bg-muted-foreground opacity-25 origin-left transition-all" />
            01
          </span>
          <span className="font-serif text-[1.55rem] font-bold text-foreground tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">פרופיל מקצועי</span>
          <span className="ms-auto text-[0.7rem] text-muted-foreground py-[0.28rem] px-[0.8rem] rounded-full bg-muted/40 border border-border tracking-[0.04em] tabular-nums font-medium mb-[0.2rem] transition-all hover:border-muted-foreground/30 hover:text-muted-foreground">
            {lastUpdated
              ? `עודכן ${new Date(lastUpdated).toLocaleDateString('he-IL')}`
              : 'מקור: קובץ מקומי'}
          </span>
        </div>
        <p className="text-[0.92rem] text-muted-foreground leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          הפרופיל המקצועי שנשלח ל-Claude לצורך ניתוח והתאמת משרות. השינויים נכנסים לתוקף מיידית לאחר שמירה.
        </p>
        <textarea
          className="w-full min-h-[420px] p-[1.5rem_1.65rem] border border-border rounded-lg text-foreground font-code text-[0.85rem] resize-y outline-none leading-[1.8] ltr text-left whitespace-pre-wrap transition-all hover:border-muted-foreground/30 focus:border-ring focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,0,0,0.04)] selection:bg-primary/10 selection:text-foreground"
          value={profile}
          onChange={(e) => { setProfile(e.target.value); setProfileResult(null); }}
          dir="auto"
          spellCheck={false}
          style={{
            background: 'var(--card)',
          }}
        />
        <div className="flex justify-between items-center mt-[1.1rem] pt-4 border-t border-dashed border-border relative max-sm:flex-col max-sm:gap-3 max-sm:items-stretch">
          <span className="absolute top-[-1px] start-0 w-9 h-px bg-muted-foreground opacity-50" />
          <span className="text-[0.76rem] text-muted-foreground tabular-nums tracking-[0.05em] font-medium inline-flex items-baseline gap-[0.35rem]">
            {profile.length.toLocaleString()} תווים
            <span className="ms-2 text-muted-foreground text-[0.72rem] tracking-[0.04em] font-normal ps-[0.6rem] border-s border-border">· ≈{estimateTokens(profile).toLocaleString()} tokens</span>
          </span>
          <div className="flex gap-[0.55rem] max-sm:justify-end max-sm:flex-wrap">
            {isProfileDirty && (
              <Button variant="outline" size="sm" onClick={() => setProfile(originalProfile)} disabled={savingProfile}>
                ביטול שינויים
              </Button>
            )}
            <Button
              onClick={saveProfile}
              disabled={savingProfile || !isProfileDirty}
            >
              {savingProfile ? 'שומר...' : 'שמור פרופיל'}
            </Button>
          </div>
        </div>
        {profileResult && (
          <SaveResult result={profileResult} />
        )}
      </section>

      {/* 02 — Analyst Prompt */}
      <PromptSection
        sectionId="settings-section-02"
        num="02"
        name="פרומפט אנליסט"
        desc="ההנחיה ל-Claude בשלב פרסינג המשרה — מחלצת כותרת, טכנולוגיות, רמת ניסיון ואותות תרבותיים ומחזירה JSON מובנה."
        activeStage="parse"
        isOverride={analystIsOverride}
        value={analystPrompt}
        setValue={(v) => { setAnalystPrompt(v); setAnalystResult(null); }}
        isDirty={isAnalystDirty}
        saving={savingAnalyst}
        onSave={saveAnalyst}
        onCancel={() => setAnalystPrompt(originalAnalystPrompt)}
        onResetRequest={() => setConfirmReset('analyst')}
        confirmingReset={confirmReset === 'analyst'}
        onConfirmResetCancel={() => setConfirmReset(null)}
        onConfirmResetAccept={confirmResetAccept}
        result={analystResult}
        editorMinHeight={400}
        sectionIndex={1}
      />

      {/* 03 — Evaluator Prompt */}
      <PromptSection
        sectionId="settings-section-03"
        num="03"
        name="פרומפט הערכה"
        desc={
          <>
            ההנחיה ל-Claude בשלב ההערכה — מדרג התאמה במאה נקודות לפי טכנולוגיה, תרבות ומאפייני תפקיד.
            שני הפלייסהולדרים <code className="font-code text-[0.82em] py-[0.08em] px-[0.4em] bg-muted/50 border border-border rounded-[4px] text-muted-foreground ltr isolate">{'{{USER_PROFILE}}'}</code> ו-<code className="font-code text-[0.82em] py-[0.08em] px-[0.4em] bg-muted/50 border border-border rounded-[4px] text-muted-foreground ltr isolate">{'{{PARSED_JOB}}'}</code> מוחלפים בזמן ריצה ואסור למחוק אותם.
          </>
        }
        activeStage="evaluate"
        isOverride={evaluatorIsOverride}
        value={evaluatorPrompt}
        setValue={(v) => {
          setEvaluatorPrompt(v);
          setEvaluatorResult(null);
          if (confirmUnsafeSave) setConfirmUnsafeSave(false);
        }}
        isDirty={isEvaluatorDirty}
        saving={savingEvaluator}
        onSave={handleEvaluatorSaveClick}
        onCancel={() => { setEvaluatorPrompt(originalEvaluatorPrompt); setConfirmUnsafeSave(false); }}
        onResetRequest={() => setConfirmReset('evaluator')}
        confirmingReset={confirmReset === 'evaluator'}
        onConfirmResetCancel={() => setConfirmReset(null)}
        onConfirmResetAccept={confirmResetAccept}
        result={evaluatorResult}
        editorMinHeight={500}
        placeholders={evaluatorPlaceholderStates}
        saveWarning={evaluatorMissingPlaceholder}
        confirmUnsafeSave={confirmUnsafeSave}
        onConfirmUnsafeAccept={saveEvaluator}
        onConfirmUnsafeCancel={() => setConfirmUnsafeSave(false)}
        sectionIndex={2}
      />

      {/* 04 — Scoring Config */}
      <section className="mb-16 relative animate-section-in" id="settings-section-04" style={{ animationDelay: '0.12s' }}>
        <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border relative">
          <span className="absolute bottom-[-1px] start-0 w-11 h-0.5 bg-gradient-to-r from-muted-foreground to-transparent rounded-sm" />
          <span className="font-serif text-[2.4rem] font-bold text-muted-foreground tracking-[-0.03em] tabular-nums leading-[0.85] shrink-0 min-w-[2.6ch] ltr relative">
            <span className="absolute bottom-[0.35em] left-0 w-[0.55em] h-0.5 bg-muted-foreground opacity-25 origin-left transition-all" />
            04
          </span>
          <span className="font-serif text-[1.55rem] font-bold text-foreground tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">תצורת ניתוח</span>
        </div>
        <p className="text-[0.92rem] text-muted-foreground leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          כל שלב בצנרת מוגדר בנפרד — האנליסט (שלב הפרסינג) וההערכה (שלב הציון).
          חשיבה מורחבת מאלצת טמפרטורה של 1.
        </p>

        <div className="grid grid-cols-2 gap-[1.35rem] mt-[0.4rem] max-[860px]:grid-cols-1 max-[860px]:gap-[0.9rem]">
          <RoleConfigPanel
            role="analyst"
            stage="①"
            titleHe="אנליסט"
            titleEn="Parse"
            hint="קל ומהיר — חילוץ שדות מתיאור משרה"
            values={config.analyst}
            onChange={(k, v) => updateConfig(`analyst.${k}`, v)}
            idPrefix="cfg-a"
          />
          <RoleConfigPanel
            role="evaluator"
            stage="②"
            titleHe="הערכה"
            titleEn="Evaluate"
            hint="ניתוח עמוק — ציון, ברדיקט והערכה בעברית"
            values={config.evaluator}
            onChange={(k, v) => updateConfig(`evaluator.${k}`, v)}
            idPrefix="cfg-e"
          />
        </div>

        <div className="mt-5 pt-4 border-t border-dashed border-border max-w-[22rem]">
          <div className="flex flex-col gap-[0.55rem]">
            <label className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]" htmlFor="cfg-min-score">
              <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
              ציון מינימום לשמירה
            </label>
            <input
              id="cfg-min-score"
              type="number"
              className="py-[0.55rem] px-[0.8rem] bg-transparent border border-input rounded-[7px] text-foreground text-[0.88rem] font-mono tabular-nums ltr text-left transition-all w-full hover:border-muted-foreground/30 focus:border-ring focus:bg-white focus:ring-[3px] focus:ring-ring/20 focus:outline-none disabled:opacity-45 disabled:cursor-not-allowed"
              value={config.min_score_to_save}
              onChange={(e) => updateConfig('min_score_to_save', parseInt(e.target.value) || 70)}
              min="0" max="100" step="5"
            />
            <span className="text-[0.72rem] text-muted-foreground opacity-85 mt-[0.3rem]">סף אחד לצנרת כולה — חל על תוצאות ההערכה</span>
          </div>
        </div>

        <div className="flex justify-end items-center gap-[0.6rem] mt-6 pt-[1.1rem] border-t border-dashed border-border relative">
          <span className="absolute top-[-1px] end-0 w-9 h-px bg-muted-foreground opacity-50" />
          {isConfigDirty && (
            <Button variant="outline" size="sm" onClick={() => setConfig(originalConfig)} disabled={savingConfig}>
              ביטול שינויים
            </Button>
          )}
          <Button
            onClick={saveConfig}
            disabled={savingConfig || !isConfigDirty}
          >
            {savingConfig ? 'שומר...' : 'שמור תצורה'}
          </Button>
        </div>
        {configResult && (
          <SaveResult result={configResult} />
        )}
      </section>

      {/* 05 — Scoring Structure */}
      <section className="mb-16 relative animate-section-in" id="settings-section-05" style={{ animationDelay: '0.16s' }}>
        <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border relative">
          <span className="absolute bottom-[-1px] start-0 w-11 h-0.5 bg-gradient-to-r from-muted-foreground to-transparent rounded-sm" />
          <span className="font-serif text-[2.4rem] font-bold text-muted-foreground tracking-[-0.03em] tabular-nums leading-[0.85] shrink-0 min-w-[2.6ch] ltr relative">
            <span className="absolute bottom-[0.35em] left-0 w-[0.55em] h-0.5 bg-muted-foreground opacity-25 origin-left transition-all" />
            05
          </span>
          <span className="font-serif text-[1.55rem] font-bold text-foreground tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">מבנה ניתוח</span>
        </div>
        <p className="text-[0.92rem] text-muted-foreground leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          הציון הכולל מתחלק לשלושה ממדים. כל ממד מורכב ממספר קריטריונים משוקללים.
        </p>

        <div
          className="flex h-3 rounded-full overflow-hidden mb-[1.4rem] relative"
          aria-label="התפלגות ציון"
          style={{
            background: 'oklch(0.97 0 0)',
            boxShadow: 'none',
          }}
        >
          <div
            className="relative animate-bar-fill origin-right"
            style={{
              flex: 35,
              background: 'linear-gradient(90deg, #c9a37c 0%, #a88256 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)',
              animationDelay: '0.15s',
            }}
          />
          <div
            className="relative animate-bar-fill origin-right border-r border-[rgba(255,255,255,0.55)]"
            style={{
              flex: 35,
              background: 'linear-gradient(90deg, #5cbea9 0%, #3d9b85 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
              animationDelay: '0.25s',
            }}
          />
          <div
            className="relative animate-bar-fill origin-right border-r border-[rgba(255,255,255,0.55)]"
            style={{
              flex: 30,
              background: 'linear-gradient(90deg, #a88ed8 0%, #8b6fc0 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
              animationDelay: '0.35s',
            }}
          />
        </div>

        <div className="flex flex-col border-t border-border mb-[1.85rem]">
          <ScoringDimension
            variant="tech"
            color="#a88256"
            ringColor="rgba(168,130,86,0.12)"
            name="התאמה טכנית"
            details="Core Stack 0–20 · System Design 0–15"
            points="35"
          />
          <ScoringDimension
            variant="culture"
            color="#3d9b85"
            ringColor="rgba(61,155,133,0.12)"
            name="התאמה תרבותית"
            details="Work Style 0–15 · Communication 0–10 · Ownership 0–10"
            points="35"
          />
          <ScoringDimension
            variant="role"
            color="#8b6fc0"
            ringColor="rgba(139,111,192,0.12)"
            name="מאפייני התפקיד"
            details="Problem Domain 0–15 · Pace 0–10 · Growth 0–5"
            points="30"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-3 border-t border-dashed border-border mt-2">
          <VerdictItem className="bg-[rgba(45,143,94,0.08)] text-green border-[rgba(45,143,94,0.22)]" label="STRONG_YES · 80–100" />
          <VerdictItem className="bg-[rgba(45,143,94,0.04)] text-green border-[rgba(45,143,94,0.14)] opacity-[0.92]" label="YES · 60–79" />
          <VerdictItem className="bg-[rgba(166,139,43,0.06)] text-yellow border-[rgba(166,139,43,0.2)]" label="MAYBE · 40–59" />
          <VerdictItem className="bg-[rgba(196,84,84,0.04)] text-red border-[rgba(196,84,84,0.14)] opacity-[0.92]" label="NO · 20–39" />
          <VerdictItem className="bg-[rgba(196,84,84,0.07)] text-red border-[rgba(196,84,84,0.2)]" label="STRONG_NO · 0–19" />
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Verdict Item                                                       */
/* ------------------------------------------------------------------ */
function VerdictItem({ className, label }) {
  return (
    <span className={`relative py-[0.38rem] pe-[0.9rem] ps-[1.45rem] rounded-full text-[0.73rem] font-medium font-code tabular-nums tracking-[0.08em] border cursor-default transition-all hover:-translate-y-px hover:shadow-sm ${className}`}>
      <span className="absolute top-1/2 start-[0.65rem] -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-current opacity-75" />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Scoring Dimension                                                  */
/* ------------------------------------------------------------------ */
function ScoringDimension({ color, ringColor, name, details, points }) {
  return (
    <div
      className="group grid grid-cols-[auto_1fr_auto] items-center gap-[1.1rem] py-[1.15rem] px-[0.35rem] border-b border-border transition-all relative hover:bg-accent hover:ps-[0.65rem] max-sm:grid-cols-[auto_1fr] max-sm:row-gap-1"
      style={{ color }}
    >
      {/* Left accent line on hover */}
      <span className="absolute start-[-4px] top-[18%] bottom-[18%] w-0.5 bg-current opacity-0 rounded-sm transition-opacity group-hover:opacity-55" />
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0 transition-transform group-hover:scale-[1.15]"
        style={{ background: color, boxShadow: `0 0 0 3px ${ringColor}` }}
      />
      <div className="flex flex-col gap-[0.15rem] min-w-0">
        <span className="text-[0.95rem] font-semibold text-foreground font-serif tracking-[-0.005em]">{name}</span>
        <span className="text-[0.78rem] text-muted-foreground font-mono tabular-nums tracking-[0.02em] ltr text-right">{details}</span>
      </div>
      <span className="font-serif text-[1.15rem] font-bold text-foreground tabular-nums tracking-[-0.01em] max-sm:col-start-2 max-sm:justify-self-end">
        {points}<small className="text-[0.65rem] text-muted-foreground tracking-[0.15em] uppercase font-medium font-mono ms-1">pt</small>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Save Result                                                        */
/* ------------------------------------------------------------------ */
function SaveResult({ result }) {
  const isSuccess = result.type === 'success';
  return (
    <div
      className={`flex items-center gap-[0.65rem] mt-4 p-[0.8rem_1.1rem] rounded text-[0.84rem] font-medium border animate-result-in relative overflow-hidden ${
        isSuccess
          ? 'bg-emerald-50/70 border-emerald-200/50 text-emerald-700'
          : 'bg-red-50/70 border-red-200/50 text-red-700'
      }`}
    >
      <span className="w-[18px] h-[18px] rounded-full bg-current opacity-15 shrink-0 relative" />
      <span
        className="absolute start-[1.1rem] top-1/2 -translate-y-1/2 w-[18px] h-[18px]"
        style={{
          background: isSuccess
            ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%232d8f5e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='5,10.5 9,14.5 15.5,7'/%3E%3C/svg%3E\") center / 12px no-repeat"
            : "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23c45454' stroke-width='2.5' stroke-linecap='round'%3E%3Cline x1='10' y1='5' x2='10' y2='11.5'/%3E%3Ccircle cx='10' cy='14.5' r='0.5'/%3E%3C/svg%3E\") center / 12px no-repeat",
        }}
      />
      {result.message}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Prompt Section                                                     */
/* ------------------------------------------------------------------ */
function PromptSection({
  sectionId, num, name, desc, activeStage, isOverride,
  value, setValue, isDirty, saving,
  onSave, onCancel, onResetRequest,
  confirmingReset, onConfirmResetCancel, onConfirmResetAccept,
  result, editorMinHeight,
  placeholders, saveWarning, confirmUnsafeSave,
  onConfirmUnsafeAccept, onConfirmUnsafeCancel,
  sectionIndex,
}) {
  const textareaRef = useRef(null);
  const headings = useMemo(() => detectHeadings(value), [value]);

  const sectionDelays = { 1: '0.04s', 2: '0.08s', 3: '0.12s', 4: '0.16s', 5: '0.2s' };

  return (
    <section
      className="mb-16 relative animate-section-in ps-6 max-sm:ps-[1.15rem]"
      id={sectionId}
      style={{ animationDelay: sectionDelays[sectionIndex] || '0s' }}
    >
      {/* Prompt accent stripe */}
      <span
        className="absolute start-0 w-[3px] rounded-[3px]"
        style={{
          top: '0.15rem',
          bottom: '0.15rem',
          background: 'linear-gradient(to bottom, transparent 0%, oklch(0.7 0 0 / 0.25) 12%, oklch(0.7 0 0 / 0.25) 88%, transparent 100%)',
        }}
      />

      <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border relative">
        <span className="absolute bottom-[-1px] start-0 w-11 h-0.5 bg-gradient-to-r from-muted-foreground to-transparent rounded-sm" />
        <span className="font-serif text-[2.4rem] font-bold text-muted-foreground tracking-[-0.03em] tabular-nums leading-[0.85] shrink-0 min-w-[2.6ch] ltr relative">
          <span className="absolute bottom-[0.35em] left-0 w-[0.55em] h-0.5 bg-muted-foreground opacity-25 origin-left transition-all" />
          {num}
        </span>
        <span className="font-serif text-[1.55rem] font-bold text-foreground tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">{name}</span>
        <span className={`ms-auto text-[0.7rem] py-[0.28rem] px-[0.8rem] rounded-full border tracking-[0.04em] tabular-nums font-medium mb-[0.2rem] transition-all hover:border-muted-foreground/30 hover:text-muted-foreground ${
          isOverride
            ? 'text-foreground border-primary/30 bg-primary/5'
            : 'text-muted-foreground bg-muted/40 border-border'
        }`}>
          {isOverride ? 'מותאם אישית' : 'ברירת מחדל'}
        </span>
      </div>

      <div
        className="flex items-center gap-4 my-[0.6rem] mb-[1.4rem] py-[0.6rem] px-4 border border-border rounded-full max-w-fit font-mono max-sm:flex-col max-sm:items-start max-sm:gap-[0.45rem] max-sm:max-w-full max-sm:rounded-xl max-sm:px-[0.85rem] max-sm:py-[0.7rem]"
        aria-label="שלבי ניתוח"
        style={{
          background: 'var(--muted)',
        }}
      >
        <span className={`inline-flex items-center gap-2 text-[0.8rem] tracking-[0.03em] transition-colors ${activeStage === 'parse' ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
          <span className={`font-serif text-[1.1rem] leading-none transition-all tabular-nums ${activeStage === 'parse' ? 'text-foreground' : 'text-muted-foreground/40'}`}>①</span>
          <span className={`tabular-nums ${activeStage === 'parse' ? 'border-b border-foreground/40 pb-0.5' : ''}`}>Parse · אנליסט</span>
        </span>
        {/* Arrow */}
        <span className="w-[1.6rem] h-px shrink-0 relative max-sm:w-px max-sm:h-4" style={{ background: 'linear-gradient(to left, transparent 0%, oklch(0.7 0 0 / 0.35) 50%, transparent 100%)' }}>
          <span
            className="absolute top-1/2 end-0 w-[5px] h-[5px] -translate-y-1/2 max-sm:top-auto max-sm:bottom-0 max-sm:end-1/2 max-sm:translate-x-1/2"
            style={{
              borderTop: '1px solid oklch(0.7 0 0 / 0.45)',
              borderInlineEnd: '1px solid oklch(0.7 0 0 / 0.45)',
              transform: 'translateY(-50%) rotate(-135deg)',
            }}
          />
        </span>
        <span className={`inline-flex items-center gap-2 text-[0.8rem] tracking-[0.03em] transition-colors ${activeStage === 'evaluate' ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
          <span className={`font-serif text-[1.1rem] leading-none transition-all tabular-nums ${activeStage === 'evaluate' ? 'text-foreground' : 'text-muted-foreground/40'}`}>②</span>
          <span className={`tabular-nums ${activeStage === 'evaluate' ? 'border-b border-foreground/40 pb-0.5' : ''}`}>Evaluate · הערכה</span>
        </span>
      </div>

      <p className="text-[0.92rem] text-muted-foreground leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">{desc}</p>

      {placeholders && placeholders.length > 0 && (
        <div className="flex flex-wrap gap-[0.7rem] -mt-2 mb-[1.1rem] p-[0.6rem_0.85rem] border border-dashed border-border rounded-lg bg-muted/20 max-sm:p-[0.55rem_0.7rem]" role="status" aria-live="polite">
          {placeholders.map(({ token, present }) => (
            <span
              key={token}
              className={`inline-flex items-center gap-[0.4rem] py-[0.22rem] pe-[0.6rem] ps-[0.7rem] rounded-full font-mono text-[0.74rem] tabular-nums tracking-[0.02em] transition-all ${
                present
                  ? 'border border-[rgba(45,143,94,0.22)] bg-[rgba(45,143,94,0.04)] text-green'
                  : 'border border-[rgba(196,84,84,0.35)] bg-[rgba(196,84,84,0.05)] text-red animate-[placeholderMiss_0.25s_ease_both]'
              }`}
            >
              <span className="ltr">{token}</span>
              <span className="font-serif text-[0.9rem] leading-none" aria-hidden="true">
                {present ? '✓' : '✗'}
              </span>
              {!present && <span className="text-[0.7rem] tracking-[0.08em] uppercase text-red">חסר</span>}
            </span>
          ))}
        </div>
      )}

      {headings.length > 0 && (
        <div className="flex flex-wrap gap-[0.35rem] mb-[0.85rem] py-[0.1rem] max-sm:gap-[0.3rem]" aria-label="מבנה הפרומפט">
          {headings.map((h, i) => (
            <button
              key={`${h.offset}-${i}`}
              type="button"
              className={`inline-flex items-baseline gap-[0.35rem] py-[0.28rem] px-[0.7rem] border border-border rounded-full bg-transparent text-muted-foreground font-mono text-[0.74rem] tracking-[0.02em] cursor-pointer transition-all hover:border-foreground/30 hover:bg-accent hover:text-foreground hover:-translate-y-px active:translate-y-0 ${
                h.level === 1 ? 'font-semibold text-foreground' : h.level === 2 ? 'font-medium' : 'opacity-[0.78]'
              }`}
              onClick={() => scrollTextareaToOffset(textareaRef.current, h.offset)}
              title={`קפוץ אל "${h.text}"`}
            >
              <span className="font-[Courier_New,monospace] text-[0.7rem] text-muted-foreground opacity-55 tracking-[-0.05em]" aria-hidden="true">{'#'.repeat(h.level)}</span>
              <span className="tabular-nums">{h.text}</span>
            </button>
          ))}
        </div>
      )}

      {confirmingReset && (
        <div className="flex items-center justify-between gap-5 mb-[0.9rem] p-[0.95rem_1.15rem] rounded-lg animate-confirm-slide flex-wrap bg-muted/30 border border-border max-sm:flex-col max-sm:items-stretch max-sm:gap-[0.7rem]" role="alertdialog" aria-live="assertive">
          <div className="flex flex-col gap-1 flex-[1_1_260px] min-w-0">
            <strong className="font-serif text-[0.95rem] font-bold tracking-[-0.005em] text-foreground">לאפס לברירת מחדל?</strong>
            <span className="text-[0.8rem] leading-[1.6] text-muted-foreground max-w-[520px]">
              הפרומפט המותאם אישית יימחק ויוחלף בברירת המחדל המצורפת לשירות. פעולה זו לא ניתנת לביטול.
            </span>
          </div>
          <div className="flex gap-2 shrink-0 max-sm:justify-end">
            <Button variant="outline" size="sm" onClick={onConfirmResetCancel} disabled={saving}>
              ביטול
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirmResetAccept}
              disabled={saving}
            >
              {saving ? 'מאפס...' : 'כן, אפס'}
            </Button>
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="w-full p-[1.5rem_1.65rem] border border-input rounded-lg text-foreground font-code text-[0.85rem] resize-y outline-none leading-[1.8] ltr text-left whitespace-pre-wrap transition-all hover:border-muted-foreground/30 focus:border-ring focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,0,0,0.04)] selection:bg-primary/10 selection:text-foreground"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        dir="auto"
        spellCheck={false}
        style={{
          minHeight: `${editorMinHeight}px`,
          background: 'var(--card)',
        }}
      />

      {confirmUnsafeSave && (
        <div className="flex items-center justify-between gap-5 mb-[0.9rem] p-[0.95rem_1.15rem] rounded-lg animate-confirm-slide flex-wrap bg-destructive/5 border border-destructive/20 max-sm:flex-col max-sm:items-stretch max-sm:gap-[0.7rem]" role="alertdialog" aria-live="assertive">
          <div className="flex flex-col gap-1 flex-[1_1_260px] min-w-0">
            <strong className="font-serif text-[0.95rem] font-bold tracking-[-0.005em] text-destructive">חסר פלייסהולדר בפרומפט</strong>
            <span className="text-[0.8rem] leading-[1.6] text-muted-foreground max-w-[520px]">
              ללא הפלייסהולדרים Claude לא יקבל את הפרופיל או את פרטי המשרה. אפשר לשמור בכל זאת, אך הניתוח יהיה שבור.
            </span>
          </div>
          <div className="flex gap-2 shrink-0 max-sm:justify-end">
            <Button variant="outline" size="sm" onClick={onConfirmUnsafeCancel} disabled={saving}>
              ביטול
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirmUnsafeAccept}
              disabled={saving}
            >
              {saving ? 'שומר...' : 'שמור בכל זאת'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mt-[1.1rem] pt-4 border-t border-dashed border-border relative max-sm:flex-col max-sm:gap-3 max-sm:items-stretch">
        <span className="absolute top-[-1px] start-0 w-9 h-px bg-muted-foreground opacity-50" />
        <span className="text-[0.76rem] text-muted-foreground tabular-nums tracking-[0.05em] font-medium inline-flex items-baseline gap-[0.35rem]">
          {(value?.length || 0).toLocaleString()} תווים
          <span className="ms-2 text-muted-foreground text-[0.72rem] tracking-[0.04em] font-normal ps-[0.6rem] border-s border-border">· ≈{estimateTokens(value).toLocaleString()} tokens</span>
        </span>
        <div className="flex gap-[0.55rem] max-sm:justify-end max-sm:flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={onResetRequest}
            disabled={saving || confirmingReset}
            title="אפס לברירת המחדל המצורפת לשירות"
          >
            אפס לברירת מחדל
          </Button>
          {isDirty && (
            <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
              ביטול שינויים
            </Button>
          )}
          <Button
            className={saveWarning ? 'shadow-[0_0_0_3px_hsl(var(--destructive)/0.18),0_1px_2px_rgba(0,0,0,0.06)] animate-warn-pulse hover:shadow-[0_0_0_4px_hsl(var(--destructive)/0.22),0_2px_6px_rgba(0,0,0,0.08)]' : ''}
            onClick={onSave}
            disabled={saving || !isDirty}
            title={saveWarning ? 'חסר פלייסהולדר — יידרש אישור נוסף' : undefined}
          >
            {saving ? 'שומר...' : 'שמור פרומפט'}
          </Button>
        </div>
      </div>

      {result && (
        <SaveResult result={result} />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Role Config Panel                                                  */
/* ------------------------------------------------------------------ */
function RoleConfigPanel({ role, stage, titleHe, titleEn, hint, values, onChange, idPrefix }) {
  const modelId = `${idPrefix}-model`;
  const tempId = `${idPrefix}-temp`;
  const tokensId = `${idPrefix}-tokens`;
  const thinkId = `${idPrefix}-thinking`;
  const budgetId = `${idPrefix}-thinking-budget`;

  const roleStyles = {
    analyst: {
      '--role-color': '#a88256',
      '--role-color-soft': 'rgba(168,130,86,0.09)',
      '--role-color-ring': 'rgba(168,130,86,0.3)',
      background: 'var(--card)',
    },
    evaluator: {
      '--role-color': '#3d9b85',
      '--role-color-soft': 'rgba(61,155,133,0.08)',
      '--role-color-ring': 'rgba(61,155,133,0.28)',
      background: 'var(--card)',
    },
  };

  const roleColor = role === 'analyst' ? '#a88256' : '#3d9b85';
  const roleColorSoft = role === 'analyst' ? 'rgba(168,130,86,0.09)' : 'rgba(61,155,133,0.08)';
  const roleColorRing = role === 'analyst' ? 'rgba(168,130,86,0.3)' : 'rgba(61,155,133,0.28)';

  const inputClasses = "py-[0.55rem] px-[0.8rem] bg-transparent border border-input rounded-[7px] text-foreground text-[0.88rem] font-mono tabular-nums ltr text-left transition-all w-full hover:border-muted-foreground/30 hover:bg-background focus:outline-none disabled:opacity-45 disabled:cursor-not-allowed";

  return (
    <div
      className="flex flex-col gap-[0.95rem] p-[1.35rem_1.4rem_1.2rem] border border-input rounded-lg relative overflow-hidden transition-all hover:shadow-sm"
      style={{
        ...roleStyles[role],
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = roleColorRing;
        e.currentTarget.style.boxShadow = `0 2px 10px rgba(0,0,0,0.04), 0 0 0 1px ${roleColorRing}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '';
        e.currentTarget.style.boxShadow = '';
      }}
    >
      {/* Top accent stripe */}
      <span
        className="absolute top-0 left-0 right-0 h-[3px] opacity-70"
        style={{ background: `linear-gradient(90deg, ${roleColor} 0%, transparent 100%)` }}
      />

      <div className="flex flex-col gap-[0.4rem] pb-[0.85rem] border-b border-dashed border-border relative">
        <div className="flex items-center gap-[0.65rem]">
          <span className="font-serif text-[1.35rem] leading-none font-bold opacity-85 shrink-0 tabular-nums" style={{ color: roleColor }}>{stage}</span>
          <h3 className="inline-flex items-baseline gap-2 text-[0.95rem] text-foreground font-serif font-bold m-0 tracking-[-0.005em] flex-1 min-w-0">
            <span className="font-bold">{titleHe}</span>
            <span className="text-muted-foreground opacity-60 font-normal text-[0.85em]" aria-hidden="true">·</span>
            <span className="font-mono text-[0.72rem] tracking-[0.22em] uppercase font-semibold ltr" style={{ color: roleColor }}>{titleEn}</span>
          </h3>
          <span
            className="w-2 h-2 rounded-full shrink-0 animate-pulse-dot"
            style={{
              background: roleColor,
              boxShadow: `0 0 0 3px ${roleColorSoft}`,
              animationDelay: role === 'evaluator' ? '1.6s' : undefined,
            }}
            aria-hidden="true"
          />
        </div>
        <p className="text-[0.78rem] text-muted-foreground leading-[1.55] m-0 ps-[1.9rem]">{hint}</p>
      </div>

      <div className="flex flex-col gap-[0.95rem]">
        <div className="flex flex-col gap-[0.55rem]">
          <label className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]" htmlFor={modelId}>
            <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
            מודל Claude
          </label>
          <select
            id={modelId}
            className={inputClasses}
            value={values.model}
            onChange={(e) => onChange('model', e.target.value)}
            style={{ '--focus-color': roleColor }}
            onFocus={(e) => { e.target.style.borderColor = roleColor; e.target.style.boxShadow = `0 0 0 3px ${roleColorSoft}`; }}
            onBlur={(e) => { e.target.style.borderColor = ''; e.target.style.boxShadow = ''; }}
          >
            {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-[0.55rem]">
          <label className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]" htmlFor={tempId}>
            <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
            טמפרטורה
          </label>
          <input
            id={tempId}
            type="number"
            className={inputClasses}
            value={values.temperature}
            onChange={(e) => onChange('temperature', parseFloat(e.target.value) || 0)}
            min="0" max="1" step="0.1"
            disabled={values.thinking_enabled}
            onFocus={(e) => { e.target.style.borderColor = roleColor; e.target.style.boxShadow = `0 0 0 3px ${roleColorSoft}`; }}
            onBlur={(e) => { e.target.style.borderColor = ''; e.target.style.boxShadow = ''; }}
          />
        </div>

        <div className="flex flex-col gap-[0.55rem]">
          <label className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]" htmlFor={tokensId}>
            <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
            Max Tokens
          </label>
          <input
            id={tokensId}
            type="number"
            className={inputClasses}
            value={values.max_tokens}
            onChange={(e) => onChange('max_tokens', parseInt(e.target.value) || 1024)}
            min="512" max="16384" step="512"
            onFocus={(e) => { e.target.style.borderColor = roleColor; e.target.style.boxShadow = `0 0 0 3px ${roleColorSoft}`; }}
            onBlur={(e) => { e.target.style.borderColor = ''; e.target.style.boxShadow = ''; }}
          />
        </div>

        <div className="flex flex-col gap-[0.55rem]">
          <label className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]" htmlFor={thinkId}>
            <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
            חשיבה מורחבת
          </label>
          <select
            id={thinkId}
            className={inputClasses}
            value={values.thinking_enabled ? 'on' : 'off'}
            onChange={(e) => onChange('thinking_enabled', e.target.value === 'on')}
            onFocus={(e) => { e.target.style.borderColor = roleColor; e.target.style.boxShadow = `0 0 0 3px ${roleColorSoft}`; }}
            onBlur={(e) => { e.target.style.borderColor = ''; e.target.style.boxShadow = ''; }}
          >
            <option value="on">מופעל (temperature=1)</option>
            <option value="off">כבוי</option>
          </select>
        </div>

        <div className="flex flex-col gap-[0.55rem]">
          <label className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]" htmlFor={budgetId}>
            <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
            תקציב חשיבה · tokens
          </label>
          <input
            id={budgetId}
            type="number"
            className={inputClasses}
            value={values.thinking_budget}
            onChange={(e) => onChange('thinking_budget', parseInt(e.target.value) || 2048)}
            min="1024" max="16000" step="512"
            disabled={!values.thinking_enabled}
            onFocus={(e) => { e.target.style.borderColor = roleColor; e.target.style.boxShadow = `0 0 0 3px ${roleColorSoft}`; }}
            onBlur={(e) => { e.target.style.borderColor = ''; e.target.style.boxShadow = ''; }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Folio Rail                                                         */
/* ------------------------------------------------------------------ */
function FolioRail({ activeId, dirtyMap }) {
  return (
    <aside className="hidden xl:block fixed top-1/2 start-7 -translate-y-1/2 z-40 w-[108px] py-5 px-3 font-mono animate-rail-in pointer-events-auto" aria-label="ניווט בעמוד">
      {/* Vertical line */}
      <span
        className="absolute top-0 bottom-0 end-0 w-px"
        style={{ background: 'linear-gradient(to bottom, transparent 0%, oklch(0.7 0 0 / 0.15) 18%, oklch(0.7 0 0 / 0.15) 82%, transparent 100%)' }}
      />
      <div className="font-serif text-[1.3rem] text-muted-foreground text-start mb-4 ps-1 opacity-75" aria-hidden="true">§</div>
      <ol className="list-none m-0 p-0 flex flex-col gap-[0.1rem]">
        {SECTIONS.map((s) => {
          const isActive = activeId === s.id;
          const isDirty = dirtyMap[s.num];
          return (
            <li key={s.id} className="m-0">
              <button
                type="button"
                className={`grid grid-cols-[auto_14px_1fr_auto] items-center gap-[0.55rem] w-full py-2 px-[0.35rem] bg-transparent border-none cursor-pointer font-sans text-start transition-all relative hover:translate-x-[2px] rtl:hover:-translate-x-[2px] ${
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => scrollToSection(s.id)}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`${s.num} — ${s.name}${isDirty ? ' (לא נשמר)' : ''}`}
              >
                <span className={`font-serif font-semibold tabular-nums leading-none min-w-[1.6ch] ltr transition-all ${
                  isActive ? 'text-[1.1rem] text-foreground' : 'text-[0.9rem]'
                }`} style={{ color: isActive ? undefined : 'inherit' }}>{s.num}</span>
                <span
                  className={`h-px transition-all ${isActive ? 'w-[14px] opacity-90 bg-foreground h-0.5' : 'w-2 opacity-35 bg-current'}`}
                  aria-hidden="true"
                />
                <span className={`text-[0.66rem] tracking-[0.18em] uppercase font-medium ltr whitespace-nowrap transition-all ${
                  isActive ? 'opacity-100 text-foreground font-semibold' : 'opacity-70'
                }`} style={{ color: isActive ? undefined : 'inherit' }}>{s.short}</span>
                {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-destructive shadow-[0_0_0_3px_oklch(0.6_0.2_25/0.15)] shrink-0 animate-dirty-pulse" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 ps-[0.35rem] flex items-baseline gap-[0.2rem] font-code text-[0.68rem] text-muted-foreground tracking-[0.1em] tabular-nums opacity-60 ltr" aria-hidden="true">
        <span>{SECTIONS.length.toString().padStart(2, '0')}</span>
        <span className="text-muted-foreground opacity-60">/</span>
        <span className="text-muted-foreground">{SECTIONS.length.toString().padStart(2, '0')}</span>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Unsaved Dock                                                       */
/* ------------------------------------------------------------------ */
function UnsavedDock({ dirtyList }) {
  const visible = dirtyList.length > 0;
  return (
    <div
      className={`fixed bottom-6 left-1/2 z-[45] max-w-[calc(100vw-2.5rem)] transition-all duration-[420ms] max-[860px]:bottom-4 ${
        visible
          ? '-translate-x-1/2 translate-y-0 opacity-100 pointer-events-auto'
          : '-translate-x-1/2 translate-y-[140%] opacity-0 pointer-events-none'
      }`}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      <div
        className="flex items-center gap-4 py-[0.65rem] pe-3 ps-4 backdrop-blur-[20px] border border-border rounded-full flex-wrap max-[860px]:p-[0.5rem_0.65rem_0.5rem_0.85rem] max-[860px]:rounded-[18px] max-[860px]:gap-[0.7rem]"
        style={{
          background: 'oklch(1 0 0 / 0.88)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.25)',
          backdropFilter: 'blur(20px) saturate(1.25)',
          boxShadow: '0 18px 48px rgba(0,0,0,0.06), 0 4px 14px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.85)',
        }}
      >
        <div className="inline-flex items-center gap-[0.55rem] pe-[0.9rem] border-e border-border font-mono text-[0.82rem] text-foreground font-medium max-[860px]:pe-[0.7rem] max-[860px]:text-[0.76rem]">
          <span className="w-2 h-2 rounded-full bg-amber-400 relative shrink-0">
            <span className="absolute inset-[-4px] rounded-full bg-amber-400 opacity-30 animate-dock-pulse" />
          </span>
          <span className="font-serif text-[1.1rem] font-bold text-foreground leading-none tabular-nums ltr">{dirtyList.length}</span>
          <span className="text-muted-foreground tracking-[0.01em]">
            {dirtyList.length === 1 ? 'שינוי לא שמור' : 'שינויים לא שמורים'}
          </span>
        </div>
        <div className="inline-flex items-center gap-[0.4rem] flex-wrap max-[860px]:gap-[0.3rem]">
          {dirtyList.map((s) => (
            <button
              key={s.id}
              type="button"
              className="inline-flex items-center gap-[0.4rem] py-[0.32rem] pe-[0.85rem] ps-[0.55rem] border border-border rounded-full bg-white text-foreground font-mono text-[0.76rem] font-medium cursor-pointer transition-all hover:border-foreground/30 hover:-translate-y-px hover:shadow-md max-[860px]:py-[0.28rem] max-[860px]:pe-[0.7rem] max-[860px]:ps-[0.45rem] max-[860px]:text-[0.72rem]"
              onClick={() => scrollToSection(s.id)}
              title={`קפוץ ל-${s.name}`}
            >
              <span className="font-serif font-bold text-foreground tabular-nums ltr py-[0.08rem] px-[0.45rem] bg-muted rounded-full text-[0.72rem] leading-[1.4]">{s.num}</span>
              <span className="tracking-[0.01em] max-[860px]:hidden">{s.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading Skeleton                                                   */
/* ------------------------------------------------------------------ */
const SETTINGS_HERO_LETTERS = ['ה', 'ג', 'ד', 'ר', 'ו', 'ת'];

function SettingsLoadingSkeleton() {
  return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-16 pb-32 animate-page-in isolate" role="status" aria-live="polite" aria-label="טוען הגדרות">
      <header className="mb-12 pb-6 relative" aria-hidden="true">
        <span className="inline-block font-mono text-[0.72rem] tracking-[0.22em] uppercase text-muted-foreground mb-[0.65rem] opacity-85">Configuration · 2026</span>
        <h1 className="font-serif text-[clamp(2.2rem,4.5vw,3rem)] font-bold text-foreground leading-[1.05] m-0 mb-4 tracking-[-0.015em] flex items-baseline">
          {SETTINGS_HERO_LETTERS.map((ch, i) => (
            <span
              key={i}
              className="inline-block opacity-0 translate-y-2 relative"
              style={{
                animation: 'settingsLetterInk 0.6s cubic-bezier(0.22,1,0.36,1) forwards',
                animationDelay: `${i * 65 + 80}ms`,
              }}
            >
              {ch}
              <span
                className="absolute bottom-[0.08em] left-0 right-0 h-[0.12em]"
                style={{
                  background: 'linear-gradient(90deg, transparent, oklch(0.7 0 0 / 0.25), transparent)',
                  opacity: 0,
                  animation: 'settingsLetterUnderline 1.5s ease-out forwards',
                  animationDelay: `${i * 65 + 220}ms`,
                }}
              />
            </span>
          ))}
        </h1>
        <div className="skeleton w-[62%] h-[14px] rounded-[4px] mt-2" />
        {/* Track wipe */}
        <div
          className="mt-[1.4rem] h-px relative overflow-hidden"
          style={{ background: 'linear-gradient(to left, transparent, oklch(0.7 0 0 / 0.2) 50%, transparent)' }}
        >
          <span
            className="absolute top-[-1px] bottom-[-1px] w-[28%] animate-track-sweep"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, oklch(0.7 0 0 / 0.55) 50%, transparent 100%)',
              filter: 'blur(0.5px)',
              boxShadow: '0 0 6px oklch(0.7 0 0 / 0.3)',
            }}
          />
        </div>
      </header>

      {/* Section ghost - profile editor */}
      <section
        className="mb-10 pb-8 border-b border-border"
        style={{
          animation: 'settingsSectionRise 0.65s cubic-bezier(0.22,1,0.36,1) both',
          animationDelay: '280ms',
        }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-[0.85rem] mb-4">
          <span className="font-serif text-[2.2rem] font-bold text-muted-foreground tracking-[0.02em] leading-none tabular-nums relative">
            01
            <span className="absolute bottom-[-0.35rem] start-0 w-[1.8rem] h-px bg-muted-foreground opacity-40" />
          </span>
          <span className="skeleton w-[140px] h-4 rounded-[4px]" />
          <span className="skeleton w-[92px] h-[18px] rounded-full ms-auto max-[720px]:hidden" />
        </div>
        <div className="skeleton w-[68%] h-3 rounded-[4px]" />
        {/* Editor preview */}
        <div className="relative bg-card/60 border border-border rounded-lg p-[1.2rem_1.25rem_1.35rem] ps-12 mt-4 overflow-hidden">
          <div className="absolute inset-0 end-auto w-9 bg-muted/30 border-e border-border flex flex-col justify-around py-[0.9rem]">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <span key={i} className="block w-[0.45rem] h-px bg-muted-foreground/30 ms-auto me-[0.45rem]" />
            ))}
          </div>
          <div className="flex flex-col gap-[0.85rem] leading-[1.75]">
            <span className="skeleton h-3 rounded-[4px] w-3/4" />
            <span className="skeleton h-3 rounded-[4px] w-full" />
            <span className="skeleton h-3 rounded-[4px] w-[45%]" />
            <span className="skeleton h-3 rounded-[4px] w-full" />
            <span className="skeleton h-3 rounded-[4px] w-3/4" />
          </div>
        </div>
      </section>

      {/* Section ghost - role configs */}
      <section
        className="mb-10 pb-8"
        style={{
          animation: 'settingsSectionRise 0.65s cubic-bezier(0.22,1,0.36,1) both',
          animationDelay: '390ms',
        }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-[0.85rem] mb-4">
          <span className="font-serif text-[2.2rem] font-bold text-muted-foreground tracking-[0.02em] leading-none tabular-nums relative">
            04
            <span className="absolute bottom-[-0.35rem] start-0 w-[1.8rem] h-px bg-muted-foreground opacity-40" />
          </span>
          <span className="skeleton w-[140px] h-4 rounded-[4px]" />
        </div>
        <div className="grid grid-cols-2 gap-px bg-border border border-border rounded-lg overflow-hidden mt-4 max-[720px]:grid-cols-1">
          {/* Analyst panel */}
          <div className="bg-card p-[1.4rem_1.35rem_1.2rem] flex flex-col gap-[0.85rem] relative">
            <span className="absolute top-0 start-0 w-[42px] h-0.5 opacity-50" style={{ background: 'linear-gradient(90deg, rgba(168,130,86,0.9), transparent)' }} />
            <div className="flex items-center gap-[0.65rem] pb-[0.65rem] border-b border-border">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  background: '#a88256',
                  animation: 'settingsPulseDot 1.8s ease-in-out infinite',
                }}
              />
              <span className="skeleton flex-1 max-w-[140px] h-[14px] rounded-[4px]" />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[0.4rem]">
                <span className="skeleton w-[48%] h-[10px] rounded-[3px]" />
                <span className="skeleton w-full h-[34px] rounded-lg" />
              </div>
            ))}
          </div>
          {/* Evaluator panel */}
          <div className="bg-card p-[1.4rem_1.35rem_1.2rem] flex flex-col gap-[0.85rem] relative">
            <span className="absolute top-0 start-0 w-[42px] h-0.5 opacity-50" style={{ background: 'linear-gradient(90deg, rgba(61,155,133,0.9), transparent)' }} />
            <div className="flex items-center gap-[0.65rem] pb-[0.65rem] border-b border-border">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  background: 'var(--teal)',
                  animation: 'settingsPulseDot 1.8s ease-in-out infinite',
                  animationDelay: '0.9s',
                }}
              />
              <span className="skeleton flex-1 max-w-[140px] h-[14px] rounded-[4px]" />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[0.4rem]">
                <span className="skeleton w-[48%] h-[10px] rounded-[3px]" />
                <span className="skeleton w-full h-[34px] rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cycling subtitle */}
      <div className="mt-11 pt-[1.4rem] border-t border-dashed border-border flex items-center gap-[0.7rem] font-serif text-[0.95rem] text-muted-foreground italic tracking-[-0.005em] relative">
        <span className="absolute top-[-1px] start-0 w-9 h-px bg-muted-foreground opacity-50" />
        <span className="font-serif text-[1.2rem] text-muted-foreground opacity-75 not-italic" aria-hidden="true">§</span>
        <span className="relative inline-block h-[1.4em] min-w-[22ch] max-[720px]:min-w-[16ch]" aria-hidden="true">
          <span className="absolute inset-0 start-0 opacity-0 translate-y-1.5 animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '0s' }}>מביא את הפרופיל</span>
          <span className="absolute inset-0 start-0 opacity-0 translate-y-1.5 animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '2s' }}>קורא פרומפטים ותצורה</span>
          <span className="absolute inset-0 start-0 opacity-0 translate-y-1.5 animate-cycle-fade whitespace-nowrap" style={{ animationDelay: '4s' }}>מכין את הלוח</span>
        </span>
        <span className="sr-only">טוען הגדרות</span>
      </div>

      {/* Inline keyframes for loading-specific animations */}
      <style>{`
        @keyframes settingsLetterInk {
          0%   { opacity: 0; transform: translateY(8px); filter: blur(2px); }
          60%  { opacity: 1; filter: blur(0); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        @keyframes settingsLetterUnderline {
          0%   { opacity: 0; transform: scaleX(0.2); }
          40%  { opacity: 1; transform: scaleX(1); }
          100% { opacity: 0; transform: scaleX(1); }
        }
        @keyframes settingsSectionRise {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes settingsPulseDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.25); opacity: 0.6; }
        }
        @keyframes placeholderMiss {
          from { transform: translateX(-2px); }
          40%  { transform: translateX(2px); }
          to   { transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .skeleton,
          [style*="settingsLetterInk"],
          [style*="settingsLetterUnderline"],
          [style*="settingsSectionRise"] {
            animation-duration: 0.001s !important;
            animation-iteration-count: 1 !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}
