import { useState, useEffect, useRef, useMemo } from 'react';
import { matchApi } from '../utils/api';
import { EVALUATOR_PLACEHOLDERS } from '../utils/constants';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';

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
  { id: 'settings-section-01', num: '01', name: 'Professional Profile', short: 'Profile' },
  { id: 'settings-section-02', num: '02', name: 'Analyst Prompt', short: 'Analyst' },
  { id: 'settings-section-03', num: '03', name: 'Evaluator Prompt', short: 'Evaluator' },
  { id: 'settings-section-04', num: '04', name: 'Analysis Config', short: 'Tuning' },
  { id: 'settings-section-05', num: '05', name: 'Scoring Structure', short: 'Scoring' },
  { id: 'settings-section-06', num: '06', name: 'Introductions', short: 'Intros' },
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

  const [elevatorPitch, setElevatorPitch] = useState('');
  const [originalElevatorPitch, setOriginalElevatorPitch] = useState('');
  const [professionalIntro, setProfessionalIntro] = useState('');
  const [originalProfessionalIntro, setOriginalProfessionalIntro] = useState('');
  const [extendedIntro, setExtendedIntro] = useState('');
  const [originalExtendedIntro, setOriginalExtendedIntro] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAnalyst, setSavingAnalyst] = useState(false);
  const [savingEvaluator, setSavingEvaluator] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingIntros, setSavingIntros] = useState(false);

  const [profileResult, setProfileResult] = useState(null);
  const [analystResult, setAnalystResult] = useState(null);
  const [evaluatorResult, setEvaluatorResult] = useState(null);
  const [configResult, setConfigResult] = useState(null);
  const [introsResult, setIntrosResult] = useState(null);

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
      const data = await matchApi('/profile');
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

      const ep = data?.elevator_pitch || '';
      setElevatorPitch(ep);
      setOriginalElevatorPitch(ep);
      const pi = data?.professional_intro || '';
      setProfessionalIntro(pi);
      setOriginalProfessionalIntro(pi);
      const ei = data?.extended_intro || '';
      setExtendedIntro(ei);
      setOriginalExtendedIntro(ei);

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
  const isIntrosDirty = elevatorPitch !== originalElevatorPitch
    || professionalIntro !== originalProfessionalIntro
    || extendedIntro !== originalExtendedIntro;

  async function saveField(body, setSaving, setResult, onSuccess, label) {
    setSaving(true);
    setResult(null);
    try {
      const data = await matchApi('/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setLastUpdated(data?.updated_at);
      if (data?.analyst_prompt_is_override !== undefined) setAnalystIsOverride(!!data.analyst_prompt_is_override);
      if (data?.evaluator_prompt_is_override !== undefined) setEvaluatorIsOverride(!!data.evaluator_prompt_is_override);
      onSuccess(data);
      setResult({ type: 'success', message: `${label} saved successfully` });
    } catch (e) {
      setResult({ type: 'error', message: `Error saving: ${e.message}` });
    } finally {
      setSaving(false);
    }
  }

  const saveProfile = () => saveField(
    { content: profile },
    setSavingProfile, setProfileResult,
    () => setOriginalProfile(profile),
    'Profile',
  );

  const saveAnalyst = () => saveField(
    { analyst_prompt: analystPrompt },
    setSavingAnalyst, setAnalystResult,
    (data) => {
      const v = data?.analyst_prompt || '';
      setAnalystPrompt(v);
      setOriginalAnalystPrompt(v);
    },
    'Analyst prompt',
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
    'Evaluator prompt',
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
    'Analysis config',
  );

  const saveIntros = () => saveField(
    { elevator_pitch: elevatorPitch, professional_intro: professionalIntro, extended_intro: extendedIntro },
    setSavingIntros, setIntrosResult,
    () => {
      setOriginalElevatorPitch(elevatorPitch);
      setOriginalProfessionalIntro(professionalIntro);
      setOriginalExtendedIntro(extendedIntro);
    },
    'Introductions',
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
        'Analyst prompt reset',
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
        'Evaluator prompt reset',
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
    '06': isIntrosDirty,
  };
  const dirtyList = SECTIONS.filter((s) => dirtyMap[s.num]);

  if (loading) return <SettingsLoadingSkeleton />;

  return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-16 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 isolate max-sm:px-4 max-sm:pt-10 max-sm:pb-14">
      <FolioRail activeId={activeSection} dirtyMap={dirtyMap} />
      <UnsavedDock dirtyList={dirtyList} />

      <header className="mb-14 relative py-[0.4rem]">
        <span className="inline-flex items-center gap-[0.55rem] font-mono text-[0.66rem] tracking-[0.3em] uppercase text-muted-foreground font-medium py-[0.32rem] pr-[0.95rem] pl-[0.7rem] border border-border rounded-full bg-muted/30 mb-[1.35rem]">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shadow-[0_0_0_3px_rgba(0,0,0,0.06)] shrink-0" />
          Configuration · 2026
        </span>
        <h1 className="font-serif text-[clamp(2.2rem,4.6vw,3.1rem)] font-bold text-foreground leading-[1.05] mb-3 tracking-[-0.018em]">Settings</h1>
        <p className="text-muted-foreground text-[0.98rem] max-w-[560px] leading-[1.65]">
          View and edit the inputs for Claude analysis — your professional profile, prompts, and model parameters.
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
      <section className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-section-01">
        <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border relative">
          <span className="absolute bottom-[-1px] left-0 w-11 h-0.5 bg-gradient-to-r from-muted-foreground to-transparent rounded-sm" />
          <span className="font-serif text-[2.4rem] font-bold text-muted-foreground tracking-[-0.03em] tabular-nums leading-[0.85] shrink-0 min-w-[2.6ch] relative group">
            <span className="absolute bottom-[0.35em] left-0 w-[0.55em] h-0.5 bg-muted-foreground opacity-25 origin-left transition-all" />
            01
          </span>
          <span className="font-serif text-[1.55rem] font-bold text-foreground tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">Professional Profile</span>
          <span className="ml-auto text-[0.7rem] text-muted-foreground py-[0.28rem] px-[0.8rem] rounded-full bg-muted/40 border border-border tracking-[0.04em] tabular-nums font-medium mb-[0.2rem] transition-all hover:border-muted-foreground/30 hover:text-muted-foreground">
            {lastUpdated
              ? `Updated ${new Date(lastUpdated).toLocaleDateString('en-US')}`
              : 'Source: local file'}
          </span>
        </div>
        <p className="text-[0.92rem] text-muted-foreground leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          The professional profile sent to Claude for job analysis and matching. Changes take effect immediately after saving.
        </p>
        <textarea
          className="w-full min-h-[420px] p-[1.5rem_1.65rem] border border-border rounded-lg text-foreground font-code text-[0.85rem] resize-y outline-none leading-[1.8] text-left whitespace-pre-wrap transition-all hover:border-muted-foreground/30 focus:border-ring focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,0,0,0.04)] selection:bg-primary/10 selection:text-foreground"
          value={profile}
          onChange={(e) => { setProfile(e.target.value); setProfileResult(null); }}
          dir="auto"
          spellCheck={false}
          style={{
            background: 'var(--card)',
          }}
        />
        <div className="flex justify-between items-center mt-[1.1rem] pt-4 border-t border-dashed border-border relative max-sm:flex-col max-sm:gap-3 max-sm:items-stretch">
          <span className="absolute top-[-1px] left-0 w-9 h-px bg-muted-foreground opacity-50" />
          <span className="text-[0.76rem] text-muted-foreground tabular-nums tracking-[0.05em] font-medium inline-flex items-baseline gap-[0.35rem]">
            {profile.length.toLocaleString()} chars
            <span className="ml-2 text-muted-foreground text-[0.72rem] tracking-[0.04em] font-normal pl-[0.6rem] border-l border-border">· ≈{estimateTokens(profile).toLocaleString()} tokens</span>
          </span>
          <div className="flex gap-[0.55rem] max-sm:justify-end max-sm:flex-wrap">
            {isProfileDirty && (
              <Button variant="outline" size="sm" onClick={() => setProfile(originalProfile)} disabled={savingProfile}>
                Discard changes
              </Button>
            )}
            <Button
              onClick={saveProfile}
              disabled={savingProfile || !isProfileDirty}
            >
              {savingProfile ? 'Saving...' : 'Save profile'}
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
        name="Analyst Prompt"
        desc="The instruction for Claude during the job parsing stage — extracts title, technologies, experience level, and cultural signals and returns structured JSON."
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
        name="Evaluator Prompt"
        desc={
          <>
            The instruction for Claude during the evaluation stage — scores fit on a 100-point scale across technology, culture, and role attributes.
            The two placeholders <code className="font-code text-[0.82em] py-[0.08em] px-[0.4em] bg-muted/50 border border-border rounded-[4px] text-muted-foreground isolate">{'{{USER_PROFILE}}'}</code> and <code className="font-code text-[0.82em] py-[0.08em] px-[0.4em] bg-muted/50 border border-border rounded-[4px] text-muted-foreground isolate">{'{{PARSED_JOB}}'}</code> are replaced at runtime and must not be removed.
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
      <section className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-section-04" style={{ animationDelay: '0.12s' }}>
        <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border relative">
          <span className="absolute bottom-[-1px] left-0 w-11 h-0.5 bg-gradient-to-r from-muted-foreground to-transparent rounded-sm" />
          <span className="font-serif text-[2.4rem] font-bold text-muted-foreground tracking-[-0.03em] tabular-nums leading-[0.85] shrink-0 min-w-[2.6ch] relative">
            <span className="absolute bottom-[0.35em] left-0 w-[0.55em] h-0.5 bg-muted-foreground opacity-25 origin-left transition-all" />
            04
          </span>
          <span className="font-serif text-[1.55rem] font-bold text-foreground tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">Analysis Config</span>
        </div>
        <p className="text-[0.92rem] text-muted-foreground leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          Each pipeline stage is configured separately — the Analyst (parsing stage) and the Evaluator (scoring stage).
          Extended thinking forces temperature to 1.
        </p>

        <div className="grid grid-cols-2 gap-[1.35rem] mt-[0.4rem] max-[860px]:grid-cols-1 max-[860px]:gap-[0.9rem]">
          <RoleConfigPanel
            role="analyst"
            stage="①"
            titleHe="Analyst"
            titleEn="Parse"
            hint="Lightweight and fast — extracts fields from a job description"
            values={config.analyst}
            onChange={(k, v) => updateConfig(`analyst.${k}`, v)}
            idPrefix="cfg-a"
          />
          <RoleConfigPanel
            role="evaluator"
            stage="②"
            titleHe="Evaluator"
            titleEn="Evaluate"
            hint="Deep analysis — score, verdict, and evaluation"
            values={config.evaluator}
            onChange={(k, v) => updateConfig(`evaluator.${k}`, v)}
            idPrefix="cfg-e"
          />
        </div>

        <div className="mt-5 pt-4 border-t border-dashed border-border max-w-[22rem]">
          <div className="flex flex-col gap-[0.55rem]">
            <label className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]" htmlFor="cfg-min-score">
              <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
              Minimum score to save
            </label>
            <input
              id="cfg-min-score"
              type="number"
              className="py-[0.55rem] px-[0.8rem] bg-transparent border border-input rounded-[7px] text-foreground text-[0.88rem] font-mono tabular-nums text-left transition-all w-full hover:border-muted-foreground/30 focus:border-ring focus:bg-white focus:ring-[3px] focus:ring-ring/20 focus:outline-none disabled:opacity-45 disabled:cursor-not-allowed"
              value={config.min_score_to_save}
              onChange={(e) => updateConfig('min_score_to_save', parseInt(e.target.value) || 70)}
              min="0" max="100" step="5"
            />
            <span className="text-[0.72rem] text-muted-foreground opacity-85 mt-[0.3rem]">A single threshold for the entire pipeline — applies to evaluation results</span>
          </div>
        </div>

        <div className="flex justify-end items-center gap-[0.6rem] mt-6 pt-[1.1rem] border-t border-dashed border-border relative">
          <span className="absolute top-[-1px] right-0 w-9 h-px bg-muted-foreground opacity-50" />
          {isConfigDirty && (
            <Button variant="outline" size="sm" onClick={() => setConfig(originalConfig)} disabled={savingConfig}>
              Discard changes
            </Button>
          )}
          <Button
            onClick={saveConfig}
            disabled={savingConfig || !isConfigDirty}
          >
            {savingConfig ? 'Saving...' : 'Save config'}
          </Button>
        </div>
        {configResult && (
          <SaveResult result={configResult} />
        )}
      </section>

      {/* 05 — Scoring Structure */}
      <section className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-section-05" style={{ animationDelay: '0.16s' }}>
        <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border relative">
          <span className="absolute bottom-[-1px] left-0 w-11 h-0.5 bg-gradient-to-r from-muted-foreground to-transparent rounded-sm" />
          <span className="font-serif text-[2.4rem] font-bold text-muted-foreground tracking-[-0.03em] tabular-nums leading-[0.85] shrink-0 min-w-[2.6ch] relative">
            <span className="absolute bottom-[0.35em] left-0 w-[0.55em] h-0.5 bg-muted-foreground opacity-25 origin-left transition-all" />
            05
          </span>
          <span className="font-serif text-[1.55rem] font-bold text-foreground tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">Scoring Structure</span>
        </div>
        <p className="text-[0.92rem] text-muted-foreground leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          The total score is divided into three dimensions. Each dimension is composed of several weighted criteria.
        </p>

        <div
          className="flex h-3 rounded-full overflow-hidden mb-[1.4rem] relative"
          aria-label="Score distribution"
          style={{
            background: 'oklch(0.97 0 0)',
            boxShadow: 'none',
          }}
        >
          <div
            className="relative origin-right"
            style={{
              flex: 35,
              background: 'linear-gradient(90deg, #c9a37c 0%, #a88256 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)',
              animationDelay: '0.15s',
            }}
          />
          <div
            className="relative origin-right border-r border-[rgba(255,255,255,0.55)]"
            style={{
              flex: 35,
              background: 'linear-gradient(90deg, #5cbea9 0%, #3d9b85 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
              animationDelay: '0.25s',
            }}
          />
          <div
            className="relative origin-right border-r border-[rgba(255,255,255,0.55)]"
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
            name="Technical Fit"
            details="Core Stack 0–20 · System Design 0–15"
            points="35"
          />
          <ScoringDimension
            variant="culture"
            color="#3d9b85"
            ringColor="rgba(61,155,133,0.12)"
            name="Cultural Fit"
            details="Work Style 0–15 · Communication 0–10 · Ownership 0–10"
            points="35"
          />
          <ScoringDimension
            variant="role"
            color="#8b6fc0"
            ringColor="rgba(139,111,192,0.12)"
            name="Role Attributes"
            details="Problem Domain 0–15 · Pace 0–10 · Growth 0–5"
            points="30"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-3 border-t border-dashed border-border mt-2">
          <VerdictItem className="bg-emerald-600/[0.08] text-emerald-600 border-emerald-600/[0.22]" label="STRONG_YES · 80–100" />
          <VerdictItem className="bg-emerald-600/[0.04] text-emerald-600 border-emerald-600/[0.14] opacity-[0.92]" label="YES · 60–79" />
          <VerdictItem className="bg-amber-600/[0.06] text-amber-600 border-amber-600/20" label="MAYBE · 40–59" />
          <VerdictItem className="bg-red-500/[0.04] text-red-500 border-red-500/[0.14] opacity-[0.92]" label="NO · 20–39" />
          <VerdictItem className="bg-red-500/[0.07] text-red-500 border-red-500/20" label="STRONG_NO · 0–19" />
        </div>
      </section>

      {/* 06 — Introductions */}
      <section className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-section-06" style={{ animationDelay: '0.2s' }}>
        <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border relative">
          <span className="absolute bottom-[-1px] left-0 w-11 h-0.5 bg-gradient-to-r from-muted-foreground to-transparent rounded-sm" />
          <span className="font-serif text-[2.4rem] font-bold text-muted-foreground tracking-[-0.03em] tabular-nums leading-[0.85] shrink-0 min-w-[2.6ch] relative">
            <span className="absolute bottom-[0.35em] left-0 w-[0.55em] h-0.5 bg-muted-foreground opacity-25 origin-left transition-all" />
            06
          </span>
          <span className="font-serif text-[1.55rem] font-bold text-foreground tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">Introductions</span>
        </div>
        <p className="text-[0.92rem] text-muted-foreground leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          Self-introduction texts shown on the tracker detail page based on application stage.
          Each stage displays the most relevant introduction type.
        </p>

        <IntroTextarea
          label="Elevator Pitch"
          hint="Shown at Decided to Apply and Applied stages — a 30-second self-introduction"
          value={elevatorPitch}
          onChange={(v) => { setElevatorPitch(v); setIntrosResult(null); }}
          minHeight={140}
        />

        <IntroTextarea
          label="Professional Introduction"
          hint="Shown alongside the elevator pitch at Phone Screen stage — a 1-2 minute professional self-introduction"
          value={professionalIntro}
          onChange={(v) => { setProfessionalIntro(v); setIntrosResult(null); }}
          minHeight={200}
        />

        <IntroTextarea
          label="Extended Introduction"
          hint="Shown at Technical Interview and Final Round stages — a 3-4 minute detailed introduction"
          value={extendedIntro}
          onChange={(v) => { setExtendedIntro(v); setIntrosResult(null); }}
          minHeight={260}
        />

        <div className="flex justify-end items-center gap-[0.6rem] mt-6 pt-[1.1rem] border-t border-dashed border-border relative">
          <span className="absolute top-[-1px] right-0 w-9 h-px bg-muted-foreground opacity-50" />
          {isIntrosDirty && (
            <Button variant="outline" size="sm" onClick={() => {
              setElevatorPitch(originalElevatorPitch);
              setProfessionalIntro(originalProfessionalIntro);
              setExtendedIntro(originalExtendedIntro);
            }} disabled={savingIntros}>
              Discard changes
            </Button>
          )}
          <Button
            onClick={saveIntros}
            disabled={savingIntros || !isIntrosDirty}
          >
            {savingIntros ? 'Saving...' : 'Save introductions'}
          </Button>
        </div>
        {introsResult && <SaveResult result={introsResult} />}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Verdict Item                                                       */
/* ------------------------------------------------------------------ */
function VerdictItem({ className, label }) {
  return (
    <span className={`relative py-[0.38rem] pr-[0.9rem] pl-[1.45rem] rounded-full text-[0.73rem] font-medium font-code tabular-nums tracking-[0.08em] border cursor-default transition-all hover:-translate-y-px hover:shadow-sm ${className}`}>
      <span className="absolute top-1/2 left-[0.65rem] -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-current opacity-75" />
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
      className="group grid grid-cols-[auto_1fr_auto] items-center gap-[1.1rem] py-[1.15rem] px-[0.35rem] border-b border-border transition-all relative hover:bg-accent hover:pl-[0.65rem] max-sm:grid-cols-[auto_1fr] max-sm:row-gap-1"
      style={{ color }}
    >
      {/* Left accent line on hover */}
      <span className="absolute left-[-4px] top-[18%] bottom-[18%] w-0.5 bg-current opacity-0 rounded-sm transition-opacity group-hover:opacity-55" />
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0 transition-transform group-hover:scale-[1.15]"
        style={{ background: color, boxShadow: `0 0 0 3px ${ringColor}` }}
      />
      <div className="flex flex-col gap-[0.15rem] min-w-0">
        <span className="text-[0.95rem] font-semibold text-foreground font-serif tracking-[-0.005em]">{name}</span>
        <span className="text-[0.78rem] text-muted-foreground font-mono tabular-nums tracking-[0.02em] text-left">{details}</span>
      </div>
      <span className="font-serif text-[1.15rem] font-bold text-foreground tabular-nums tracking-[-0.01em] max-sm:col-start-2 max-sm:justify-self-end">
        {points}<small className="text-[0.65rem] text-muted-foreground tracking-[0.15em] uppercase font-medium font-mono ml-1">pt</small>
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
      className={`flex items-center gap-[0.65rem] mt-4 p-[0.8rem_1.1rem] rounded text-[0.84rem] font-medium border animate-in fade-in duration-200 relative overflow-hidden ${
        isSuccess
          ? 'bg-emerald-50/70 border-emerald-200/50 text-emerald-700'
          : 'bg-red-50/70 border-red-200/50 text-red-700'
      }`}
    >
      <span className="w-[18px] h-[18px] rounded-full bg-current opacity-15 shrink-0 relative" />
      <span
        className="absolute left-[1.1rem] top-1/2 -translate-y-1/2 w-[18px] h-[18px]"
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
/* Intro Textarea                                                     */
/* ------------------------------------------------------------------ */
function IntroTextarea({ label, hint, value, onChange, minHeight }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline gap-[0.45rem] mb-[0.35rem]">
        <span className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]">
          <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
          {label}
        </span>
      </div>
      <p className="text-[0.78rem] text-muted-foreground leading-[1.55] mb-2">{hint}</p>
      <textarea
        className="w-full p-[1rem_1.25rem] border border-border rounded-lg text-foreground text-[0.88rem] resize-y outline-none leading-[1.8] whitespace-pre-wrap transition-all hover:border-muted-foreground/30 focus:border-ring focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,0,0,0.04)] selection:bg-primary/10 selection:text-foreground"
        style={{ minHeight: `${minHeight}px`, background: 'var(--card)' }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="auto"
        spellCheck={false}
      />
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
      className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300 pl-6 max-sm:pl-[1.15rem]"
      id={sectionId}
      style={{ animationDelay: sectionDelays[sectionIndex] || '0s' }}
    >
      {/* Prompt accent stripe */}
      <span
        className="absolute left-0 w-[3px] rounded-[3px]"
        style={{
          top: '0.15rem',
          bottom: '0.15rem',
          background: 'linear-gradient(to bottom, transparent 0%, oklch(0.7 0 0 / 0.25) 12%, oklch(0.7 0 0 / 0.25) 88%, transparent 100%)',
        }}
      />

      <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-border relative">
        <span className="absolute bottom-[-1px] left-0 w-11 h-0.5 bg-gradient-to-r from-muted-foreground to-transparent rounded-sm" />
        <span className="font-serif text-[2.4rem] font-bold text-muted-foreground tracking-[-0.03em] tabular-nums leading-[0.85] shrink-0 min-w-[2.6ch] relative">
          <span className="absolute bottom-[0.35em] left-0 w-[0.55em] h-0.5 bg-muted-foreground opacity-25 origin-left transition-all" />
          {num}
        </span>
        <span className="font-serif text-[1.55rem] font-bold text-foreground tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">{name}</span>
        <span className={`ml-auto text-[0.7rem] py-[0.28rem] px-[0.8rem] rounded-full border tracking-[0.04em] tabular-nums font-medium mb-[0.2rem] transition-all hover:border-muted-foreground/30 hover:text-muted-foreground ${
          isOverride
            ? 'text-foreground border-primary/30 bg-primary/5'
            : 'text-muted-foreground bg-muted/40 border-border'
        }`}>
          {isOverride ? 'Custom' : 'Default'}
        </span>
      </div>

      <div
        className="flex items-center gap-4 my-[0.6rem] mb-[1.4rem] py-[0.6rem] px-4 border border-border rounded-full max-w-fit font-mono max-sm:flex-col max-sm:items-start max-sm:gap-[0.45rem] max-sm:max-w-full max-sm:rounded-xl max-sm:px-[0.85rem] max-sm:py-[0.7rem]"
        aria-label="Analysis stages"
        style={{
          background: 'var(--muted)',
        }}
      >
        <span className={`inline-flex items-center gap-2 text-[0.8rem] tracking-[0.03em] transition-colors ${activeStage === 'parse' ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
          <span className={`font-serif text-[1.1rem] leading-none transition-all tabular-nums ${activeStage === 'parse' ? 'text-foreground' : 'text-muted-foreground/40'}`}>①</span>
          <span className={`tabular-nums ${activeStage === 'parse' ? 'border-b border-foreground/40 pb-0.5' : ''}`}>Parse · Analyst</span>
        </span>
        {/* Arrow */}
        <span className="w-[1.6rem] h-px shrink-0 relative max-sm:w-px max-sm:h-4" style={{ background: 'linear-gradient(to right, transparent 0%, oklch(0.7 0 0 / 0.35) 50%, transparent 100%)' }}>
          <span
            className="absolute top-1/2 right-0 w-[5px] h-[5px] -translate-y-1/2 max-sm:top-auto max-sm:bottom-0 max-sm:right-1/2 max-sm:translate-x-1/2"
            style={{
              borderTop: '1px solid oklch(0.7 0 0 / 0.45)',
              borderRight: '1px solid oklch(0.7 0 0 / 0.45)',
              transform: 'translateY(-50%) rotate(45deg)',
            }}
          />
        </span>
        <span className={`inline-flex items-center gap-2 text-[0.8rem] tracking-[0.03em] transition-colors ${activeStage === 'evaluate' ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
          <span className={`font-serif text-[1.1rem] leading-none transition-all tabular-nums ${activeStage === 'evaluate' ? 'text-foreground' : 'text-muted-foreground/40'}`}>②</span>
          <span className={`tabular-nums ${activeStage === 'evaluate' ? 'border-b border-foreground/40 pb-0.5' : ''}`}>Evaluate · Evaluator</span>
        </span>
      </div>

      <p className="text-[0.92rem] text-muted-foreground leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">{desc}</p>

      {placeholders && placeholders.length > 0 && (
        <div className="flex flex-wrap gap-[0.7rem] -mt-2 mb-[1.1rem] p-[0.6rem_0.85rem] border border-dashed border-border rounded-lg bg-muted/20 max-sm:p-[0.55rem_0.7rem]" role="status" aria-live="polite">
          {placeholders.map(({ token, present }) => (
            <span
              key={token}
              className={`inline-flex items-center gap-[0.4rem] py-[0.22rem] pr-[0.6rem] pl-[0.7rem] rounded-full font-mono text-[0.74rem] tabular-nums tracking-[0.02em] transition-all ${
                present
                  ? 'border border-emerald-600/[0.22] bg-emerald-600/[0.04] text-emerald-600'
                  : 'border border-red-500/[0.35] bg-red-500/5 text-red-500'
              }`}
            >
              <span>{token}</span>
              <span className="font-serif text-[0.9rem] leading-none" aria-hidden="true">
                {present ? '✓' : '✗'}
              </span>
              {!present && <span className="text-[0.7rem] tracking-[0.08em] uppercase text-red-500">missing</span>}
            </span>
          ))}
        </div>
      )}

      {headings.length > 0 && (
        <div className="flex flex-wrap gap-[0.35rem] mb-[0.85rem] py-[0.1rem] max-sm:gap-[0.3rem]" aria-label="Prompt structure">
          {headings.map((h, i) => (
            <button
              key={`${h.offset}-${i}`}
              type="button"
              className={`inline-flex items-baseline gap-[0.35rem] py-[0.28rem] px-[0.7rem] border border-border rounded-full bg-transparent text-muted-foreground font-mono text-[0.74rem] tracking-[0.02em] cursor-pointer transition-all hover:border-foreground/30 hover:bg-accent hover:text-foreground hover:-translate-y-px active:translate-y-0 ${
                h.level === 1 ? 'font-semibold text-foreground' : h.level === 2 ? 'font-medium' : 'opacity-[0.78]'
              }`}
              onClick={() => scrollTextareaToOffset(textareaRef.current, h.offset)}
              title={`Jump to "${h.text}"`}
            >
              <span className="font-[Courier_New,monospace] text-[0.7rem] text-muted-foreground opacity-55 tracking-[-0.05em]" aria-hidden="true">{'#'.repeat(h.level)}</span>
              <span className="tabular-nums">{h.text}</span>
            </button>
          ))}
        </div>
      )}

      {confirmingReset && (
        <div className="flex items-center justify-between gap-5 mb-[0.9rem] p-[0.95rem_1.15rem] rounded-lg animate-in fade-in slide-in-from-top-1 duration-200 flex-wrap bg-muted/30 border border-border max-sm:flex-col max-sm:items-stretch max-sm:gap-[0.7rem]" role="alertdialog" aria-live="assertive">
          <div className="flex flex-col gap-1 flex-[1_1_260px] min-w-0">
            <strong className="font-serif text-[0.95rem] font-bold tracking-[-0.005em] text-foreground">Reset to default?</strong>
            <span className="text-[0.8rem] leading-[1.6] text-muted-foreground max-w-[520px]">
              The custom prompt will be deleted and replaced with the service default. This action cannot be undone.
            </span>
          </div>
          <div className="flex gap-2 shrink-0 max-sm:justify-end">
            <Button variant="outline" size="sm" onClick={onConfirmResetCancel} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirmResetAccept}
              disabled={saving}
            >
              {saving ? 'Resetting...' : 'Yes, reset'}
            </Button>
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="w-full p-[1.5rem_1.65rem] border border-input rounded-lg text-foreground font-code text-[0.85rem] resize-y outline-none leading-[1.8] text-left whitespace-pre-wrap transition-all hover:border-muted-foreground/30 focus:border-ring focus:bg-white focus:shadow-[0_0_0_4px_rgba(0,0,0,0.04)] selection:bg-primary/10 selection:text-foreground"
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
        <div className="flex items-center justify-between gap-5 mb-[0.9rem] p-[0.95rem_1.15rem] rounded-lg animate-in fade-in slide-in-from-top-1 duration-200 flex-wrap bg-destructive/5 border border-destructive/20 max-sm:flex-col max-sm:items-stretch max-sm:gap-[0.7rem]" role="alertdialog" aria-live="assertive">
          <div className="flex flex-col gap-1 flex-[1_1_260px] min-w-0">
            <strong className="font-serif text-[0.95rem] font-bold tracking-[-0.005em] text-destructive">Missing placeholder in prompt</strong>
            <span className="text-[0.8rem] leading-[1.6] text-muted-foreground max-w-[520px]">
              Without the placeholders Claude will not receive the profile or job details. You can save anyway, but analysis will be broken.
            </span>
          </div>
          <div className="flex gap-2 shrink-0 max-sm:justify-end">
            <Button variant="outline" size="sm" onClick={onConfirmUnsafeCancel} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirmUnsafeAccept}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save anyway'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mt-[1.1rem] pt-4 border-t border-dashed border-border relative max-sm:flex-col max-sm:gap-3 max-sm:items-stretch">
        <span className="absolute top-[-1px] left-0 w-9 h-px bg-muted-foreground opacity-50" />
        <span className="text-[0.76rem] text-muted-foreground tabular-nums tracking-[0.05em] font-medium inline-flex items-baseline gap-[0.35rem]">
          {(value?.length || 0).toLocaleString()} chars
          <span className="ml-2 text-muted-foreground text-[0.72rem] tracking-[0.04em] font-normal pl-[0.6rem] border-l border-border">· ≈{estimateTokens(value).toLocaleString()} tokens</span>
        </span>
        <div className="flex gap-[0.55rem] max-sm:justify-end max-sm:flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={onResetRequest}
            disabled={saving || confirmingReset}
            title="Reset to the service default"
          >
            Reset to default
          </Button>
          {isDirty && (
            <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
              Discard changes
            </Button>
          )}
          <Button
            className={saveWarning ? 'shadow-[0_0_0_3px_hsl(var(--destructive)/0.18),0_1px_2px_rgba(0,0,0,0.06)] animate-pulse hover:shadow-[0_0_0_4px_hsl(var(--destructive)/0.22),0_2px_6px_rgba(0,0,0,0.08)]' : ''}
            onClick={onSave}
            disabled={saving || !isDirty}
            title={saveWarning ? 'Missing placeholder — additional confirmation required' : undefined}
          >
            {saving ? 'Saving...' : 'Save prompt'}
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

  const inputClasses = "py-[0.55rem] px-[0.8rem] bg-transparent border border-input rounded-[7px] text-foreground text-[0.88rem] font-mono tabular-nums text-left transition-all w-full hover:border-muted-foreground/30 hover:bg-background focus:outline-none disabled:opacity-45 disabled:cursor-not-allowed";

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
            <span className="font-mono text-[0.72rem] tracking-[0.22em] uppercase font-semibold" style={{ color: roleColor }}>{titleEn}</span>
          </h3>
          <span
            className="w-2 h-2 rounded-full shrink-0 animate-pulse"
            style={{
              background: roleColor,
              boxShadow: `0 0 0 3px ${roleColorSoft}`,
              animationDelay: role === 'evaluator' ? '1.6s' : undefined,
            }}
            aria-hidden="true"
          />
        </div>
        <p className="text-[0.78rem] text-muted-foreground leading-[1.55] m-0 pl-[1.9rem]">{hint}</p>
      </div>

      <div className="flex flex-col gap-[0.95rem]">
        <div className="flex flex-col gap-[0.55rem]">
          <label className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]" htmlFor={modelId}>
            <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
            Claude Model
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
            Temperature
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
            Extended Thinking
          </label>
          <select
            id={thinkId}
            className={inputClasses}
            value={values.thinking_enabled ? 'on' : 'off'}
            onChange={(e) => onChange('thinking_enabled', e.target.value === 'on')}
            onFocus={(e) => { e.target.style.borderColor = roleColor; e.target.style.boxShadow = `0 0 0 3px ${roleColorSoft}`; }}
            onBlur={(e) => { e.target.style.borderColor = ''; e.target.style.boxShadow = ''; }}
          >
            <option value="on">Enabled (temperature=1)</option>
            <option value="off">Disabled</option>
          </select>
        </div>

        <div className="flex flex-col gap-[0.55rem]">
          <label className="text-[0.7rem] text-muted-foreground tracking-[0.14em] uppercase font-semibold flex items-center gap-[0.4rem]" htmlFor={budgetId}>
            <span className="w-[3px] h-[3px] rounded-full bg-muted-foreground opacity-45 shrink-0" />
            Thinking Budget · tokens
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
    <aside className="hidden xl:block fixed top-1/2 left-7 -translate-y-1/2 z-40 w-[108px] py-5 px-3 font-mono animate-in fade-in slide-in-from-left-2 duration-500 pointer-events-auto" aria-label="Page navigation">
      {/* Vertical line */}
      <span
        className="absolute top-0 bottom-0 right-0 w-px"
        style={{ background: 'linear-gradient(to bottom, transparent 0%, oklch(0.7 0 0 / 0.15) 18%, oklch(0.7 0 0 / 0.15) 82%, transparent 100%)' }}
      />
      <div className="font-serif text-[1.3rem] text-muted-foreground text-left mb-4 pl-1 opacity-75" aria-hidden="true">§</div>
      <ol className="list-none m-0 p-0 flex flex-col gap-[0.1rem]">
        {SECTIONS.map((s) => {
          const isActive = activeId === s.id;
          const isDirty = dirtyMap[s.num];
          return (
            <li key={s.id} className="m-0">
              <button
                type="button"
                className={`grid grid-cols-[auto_14px_1fr_auto] items-center gap-[0.55rem] w-full py-2 px-[0.35rem] bg-transparent border-none cursor-pointer font-sans text-left transition-all relative hover:translate-x-[2px] ${
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => scrollToSection(s.id)}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`${s.num} — ${s.name}${isDirty ? ' (unsaved)' : ''}`}
              >
                <span className={`font-serif font-semibold tabular-nums leading-none min-w-[1.6ch] transition-all ${
                  isActive ? 'text-[1.1rem] text-foreground' : 'text-[0.9rem]'
                }`} style={{ color: isActive ? undefined : 'inherit' }}>{s.num}</span>
                <span
                  className={`h-px transition-all ${isActive ? 'w-[14px] opacity-90 bg-foreground h-0.5' : 'w-2 opacity-35 bg-current'}`}
                  aria-hidden="true"
                />
                <span className={`text-[0.66rem] tracking-[0.18em] uppercase font-medium whitespace-nowrap transition-all ${
                  isActive ? 'opacity-100 text-foreground font-semibold' : 'opacity-70'
                }`} style={{ color: isActive ? undefined : 'inherit' }}>{s.short}</span>
                {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-destructive shadow-[0_0_0_3px_oklch(0.6_0.2_25/0.15)] shrink-0 animate-pulse" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 pl-[0.35rem] flex items-baseline gap-[0.2rem] font-code text-[0.68rem] text-muted-foreground tracking-[0.1em] tabular-nums opacity-60" aria-hidden="true">
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
        className="flex items-center gap-4 py-[0.65rem] pr-3 pl-4 backdrop-blur-[20px] border border-border rounded-full flex-wrap max-[860px]:p-[0.5rem_0.65rem_0.5rem_0.85rem] max-[860px]:rounded-[18px] max-[860px]:gap-[0.7rem]"
        style={{
          background: 'oklch(1 0 0 / 0.88)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.25)',
          backdropFilter: 'blur(20px) saturate(1.25)',
          boxShadow: '0 18px 48px rgba(0,0,0,0.06), 0 4px 14px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.85)',
        }}
      >
        <div className="inline-flex items-center gap-[0.55rem] pr-[0.9rem] border-r border-border font-mono text-[0.82rem] text-foreground font-medium max-[860px]:pr-[0.7rem] max-[860px]:text-[0.76rem]">
          <span className="w-2 h-2 rounded-full bg-amber-400 relative shrink-0">
            <span className="absolute inset-[-4px] rounded-full bg-amber-400 opacity-30 animate-pulse" />
          </span>
          <span className="font-serif text-[1.1rem] font-bold text-foreground leading-none tabular-nums">{dirtyList.length}</span>
          <span className="text-muted-foreground tracking-[0.01em]">
            {dirtyList.length === 1 ? 'unsaved change' : 'unsaved changes'}
          </span>
        </div>
        <div className="inline-flex items-center gap-[0.4rem] flex-wrap max-[860px]:gap-[0.3rem]">
          {dirtyList.map((s) => (
            <button
              key={s.id}
              type="button"
              className="inline-flex items-center gap-[0.4rem] py-[0.32rem] pr-[0.85rem] pl-[0.55rem] border border-border rounded-full bg-white text-foreground font-mono text-[0.76rem] font-medium cursor-pointer transition-all hover:border-foreground/30 hover:-translate-y-px hover:shadow-md max-[860px]:py-[0.28rem] max-[860px]:pr-[0.7rem] max-[860px]:pl-[0.45rem] max-[860px]:text-[0.72rem]"
              onClick={() => scrollToSection(s.id)}
              title={`Jump to ${s.name}`}
            >
              <span className="font-serif font-bold text-foreground tabular-nums py-[0.08rem] px-[0.45rem] bg-muted rounded-full text-[0.72rem] leading-[1.4]">{s.num}</span>
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
function SettingsLoadingSkeleton() {
  return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-16 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 isolate" role="status" aria-live="polite" aria-label="Loading settings">
      <header className="mb-12 pb-6 relative" aria-hidden="true">
        <span className="inline-block font-mono text-[0.72rem] tracking-[0.22em] uppercase text-muted-foreground mb-[0.65rem] opacity-85">Configuration · 2026</span>
        <h1 className="font-serif text-[clamp(2.2rem,4.5vw,3rem)] font-bold text-foreground leading-[1.05] m-0 mb-4 tracking-[-0.015em] animate-in fade-in duration-300">
          Settings
        </h1>
        <Skeleton className="w-[62%] h-[14px] rounded-[4px] mt-2" />
        <div
          className="mt-[1.4rem] h-px"
          style={{ background: 'linear-gradient(to left, transparent, oklch(0.7 0 0 / 0.2) 50%, transparent)' }}
        />
      </header>

      {/* Section ghost - profile editor */}
      <section
        className="mb-10 pb-8 border-b border-border animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: '280ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-[0.85rem] mb-4">
          <span className="font-serif text-[2.2rem] font-bold text-muted-foreground tracking-[0.02em] leading-none tabular-nums relative">
            01
            <span className="absolute bottom-[-0.35rem] left-0 w-[1.8rem] h-px bg-muted-foreground opacity-40" />
          </span>
          <Skeleton className="w-[140px] h-4 rounded-[4px]" />
          <Skeleton className="w-[92px] h-[18px] rounded-full ml-auto max-[720px]:hidden" />
        </div>
        <Skeleton className="w-[68%] h-3 rounded-[4px]" />
        {/* Editor preview */}
        <div className="relative bg-card/60 border border-border rounded-lg p-[1.2rem_1.25rem_1.35rem] pl-12 mt-4 overflow-hidden">
          <div className="absolute inset-0 right-auto w-9 bg-muted/30 border-r border-border flex flex-col justify-around py-[0.9rem]">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <span key={i} className="block w-[0.45rem] h-px bg-muted-foreground/30 ml-auto mr-[0.45rem]" />
            ))}
          </div>
          <div className="flex flex-col gap-[0.85rem] leading-[1.75]">
            <Skeleton className="h-3 rounded-[4px] w-3/4" />
            <Skeleton className="h-3 rounded-[4px] w-full" />
            <Skeleton className="h-3 rounded-[4px] w-[45%]" />
            <Skeleton className="h-3 rounded-[4px] w-full" />
            <Skeleton className="h-3 rounded-[4px] w-3/4" />
          </div>
        </div>
      </section>

      {/* Section ghost - role configs */}
      <section
        className="mb-10 pb-8 animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: '390ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-[0.85rem] mb-4">
          <span className="font-serif text-[2.2rem] font-bold text-muted-foreground tracking-[0.02em] leading-none tabular-nums relative">
            04
            <span className="absolute bottom-[-0.35rem] left-0 w-[1.8rem] h-px bg-muted-foreground opacity-40" />
          </span>
          <Skeleton className="w-[140px] h-4 rounded-[4px]" />
        </div>
        <div className="grid grid-cols-2 gap-px bg-border border border-border rounded-lg overflow-hidden mt-4 max-[720px]:grid-cols-1">
          {/* Analyst panel */}
          <div className="bg-card p-[1.4rem_1.35rem_1.2rem] flex flex-col gap-[0.85rem] relative">
            <span className="absolute top-0 left-0 w-[42px] h-0.5 opacity-50" style={{ background: 'linear-gradient(90deg, rgba(168,130,86,0.9), transparent)' }} />
            <div className="flex items-center gap-[0.65rem] pb-[0.65rem] border-b border-border">
              <span
                className="w-2 h-2 rounded-full shrink-0 animate-pulse"
                style={{ background: '#a88256' }}
              />
              <Skeleton className="flex-1 max-w-[140px] h-[14px] rounded-[4px]" />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[0.4rem]">
                <Skeleton className="w-[48%] h-[10px] rounded-[3px]" />
                <Skeleton className="w-full h-[34px] rounded-lg" />
              </div>
            ))}
          </div>
          {/* Evaluator panel */}
          <div className="bg-card p-[1.4rem_1.35rem_1.2rem] flex flex-col gap-[0.85rem] relative">
            <span className="absolute top-0 left-0 w-[42px] h-0.5 opacity-50" style={{ background: 'linear-gradient(90deg, rgba(61,155,133,0.9), transparent)' }} />
            <div className="flex items-center gap-[0.65rem] pb-[0.65rem] border-b border-border">
              <span
                className="w-2 h-2 rounded-full shrink-0 animate-pulse"
                style={{ background: '#0d9488' }}
              />
              <Skeleton className="flex-1 max-w-[140px] h-[14px] rounded-[4px]" />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[0.4rem]">
                <Skeleton className="w-[48%] h-[10px] rounded-[3px]" />
                <Skeleton className="w-full h-[34px] rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cycling subtitle */}
      <div className="mt-11 pt-[1.4rem] border-t border-dashed border-border flex items-center gap-[0.7rem] font-serif text-[0.95rem] text-muted-foreground italic tracking-[-0.005em] relative">
        <span className="absolute top-[-1px] left-0 w-9 h-px bg-muted-foreground opacity-50" />
        <span className="font-serif text-[1.2rem] text-muted-foreground opacity-75 not-italic" aria-hidden="true">§</span>
        <span aria-hidden="true">Loading...</span>
        <span className="sr-only">Loading settings</span>
      </div>
    </div>
  );
}
