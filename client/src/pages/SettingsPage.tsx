import { useState, useEffect, useRef, useMemo } from 'react';
import { useProfile, useProfileHistory } from '../lib/queries';
import { useSaveProfile, useTestPrompt, useRestoreHistory } from '../lib/mutations';
import type { ProfileResponse, ConfigValue, TestPromptResult, HistoryField } from '../lib/types';
import { EVALUATOR_PLACEHOLDERS, VERDICT_LABELS } from '../lib/scoring';
import { Skeleton } from '../components/ui/skeleton';
import { SaveResult, HistoryDropdown, type SaveResultData } from '../components/settings-shared';

// Editorial button — same call API as the shadcn Button used before, so every
// existing <Button variant=... size="sm"> call site keeps working, but it now
// renders as a broadsheet stamp on the --ed-* palette.
type BtnVariant = 'default' | 'outline' | 'destructive' | 'secondary';
function Button(
  { variant = 'default', size, className = '', children, ...rest }:
  { variant?: BtnVariant; size?: 'sm' | 'default'; className?: string; children: React.ReactNode } &
  React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-none border font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-45 disabled:pointer-events-none';
  const sz = size === 'sm' ? 'px-3 py-[0.42rem] text-[0.64rem]' : 'px-4 py-[0.55rem] text-[0.68rem]';
  const variants: Record<BtnVariant, string> = {
    default:     'border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]',
    outline:     'bg-transparent border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]',
    destructive: 'bg-transparent border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10',
    secondary:   'border-[var(--ed-ink)] bg-[var(--ed-ink)] text-[var(--ed-paper)] hover:opacity-90',
  };
  return (
    <button type="button" className={`${base} ${sz} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// Vintage three-ink chart palette for the scoring infographic — one muted
// printer's ink per dimension. Shared by the distribution bar, the dimension
// list, and the role-config panels (analyst = technical, evaluator = execution).
const DIM_INK = {
  technical:      'var(--ed-gold)',
  execution:      'var(--ed-yes)',
  sustainability: 'var(--ed-accent)',
} as const;

// Shared editorial field styling.
const EDITOR_CLS = 'w-full p-[1.4rem_1.5rem] border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 text-[var(--ed-ink)] font-code text-[0.85rem] resize-y outline-none leading-[1.8] text-left whitespace-pre-wrap transition-colors hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)]';
const FIELD_INPUT = 'py-[0.55rem] px-[0.8rem] bg-transparent border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.88rem] font-code tabular-nums text-left transition-colors w-full hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] focus:outline-none disabled:opacity-45 disabled:cursor-not-allowed';
const FIELD_LABEL = 'text-[0.62rem] text-[var(--ed-ink-faint)] tracking-[0.16em] uppercase font-semibold flex items-center gap-[0.4rem]';
const META_TEXT = 'text-[0.72rem] text-[var(--ed-ink-faint)] tabular-nums tracking-[0.05em] font-medium';

const MODEL_OPTIONS: string[] = [
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-haiku-4-5-20251001',
];

interface RoleConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  thinking_enabled: boolean;
  thinking_budget: number;
}

interface VerdictBands {
  strong_yes: number;
  yes: number;
  maybe: number;
  no: number;
}

interface ScoringConfig {
  analyst: RoleConfig;
  evaluator: RoleConfig;
  min_score_to_save: number;
  verdict_bands: VerdictBands;
}

const DEFAULT_VERDICT_BANDS: VerdictBands = {
  strong_yes: 80,
  yes: 60,
  maybe: 40,
  no: 20,
};

const DEFAULT_ROLE_CONFIG: RoleConfig = {
  model: 'claude-sonnet-4-6',
  temperature: 0.5,
  max_tokens: 4096,
  thinking_enabled: false,
  thinking_budget: 2048,
};

const DEFAULT_CONFIG: ScoringConfig = {
  analyst: {
    ...DEFAULT_ROLE_CONFIG,
    model: 'claude-haiku-4-5-20251001',
    temperature: 0.3,
    max_tokens: 2048,
  },
  evaluator: { ...DEFAULT_ROLE_CONFIG },
  min_score_to_save: 70,
  verdict_bands: { ...DEFAULT_VERDICT_BANDS },
};

interface IncomingScoringConfig {
  analyst?: Partial<RoleConfig>;
  evaluator?: Partial<RoleConfig>;
  min_score_to_save?: number;
  verdict_bands?: Partial<VerdictBands>;
}

function mergeScoringConfig(incoming: Record<string, unknown>): ScoringConfig {
  const sc = (incoming || {}) as IncomingScoringConfig;
  const hasNested = sc.analyst || sc.evaluator;
  const evaluatorSource = hasNested ? (sc.evaluator || {}) : sc;
  return {
    analyst: { ...DEFAULT_CONFIG.analyst, ...(sc.analyst || {}) },
    evaluator: { ...DEFAULT_CONFIG.evaluator, ...evaluatorSource },
    min_score_to_save: sc.min_score_to_save ?? DEFAULT_CONFIG.min_score_to_save,
    verdict_bands: { ...DEFAULT_VERDICT_BANDS, ...(sc.verdict_bands || {}) },
  };
}

const estimateTokens = (text: string | undefined | null): number => Math.ceil((text?.length || 0) / 4);

interface Heading {
  level: number;
  text: string;
  offset: number;
}

const detectHeadings = (text: string | undefined | null): Heading[] => {
  if (!text) return [];
  const out: Heading[] = [];
  const re = /^(#+)\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ level: m[1].length, text: m[2].trim(), offset: m.index });
  }
  return out;
};

interface PlaceholderState {
  token: string;
  present: boolean;
}

const placeholderStatus = (text: string | undefined | null, placeholders: string[]): PlaceholderState[] =>
  placeholders.map((p) => ({ token: p, present: (text || '').includes(p) }));

function scrollTextareaToOffset(ta: HTMLTextAreaElement | null, offset: number | null): void {
  if (!ta || offset == null) return;
  const before = ta.value.slice(0, offset);
  const line = before.split('\n').length - 1;
  const cs = window.getComputedStyle(ta);
  const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.75);
  const paddingTop = parseFloat(cs.paddingTop) || 0;
  ta.scrollTop = Math.max(0, line * lineHeight - paddingTop);
  ta.focus();
  try { ta.setSelectionRange(offset, offset); } catch { /* ignore */ }
}

interface SectionInfo {
  id: string;
  num: string;
  name: string;
  short: string;
}

const SECTIONS: SectionInfo[] = [
  { id: 'settings-section-01', num: '01', name: 'Professional Profile', short: 'Profile' },
  { id: 'settings-section-02', num: '02', name: 'Analyst Prompt', short: 'Analyst' },
  { id: 'settings-section-03', num: '03', name: 'Evaluator Prompt', short: 'Evaluator' },
  { id: 'settings-section-04', num: '04', name: 'Analysis Config', short: 'Tuning' },
  { id: 'settings-section-05', num: '05', name: 'Scoring Structure', short: 'Scoring' },
];

function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const nav = document.querySelector('[data-app-nav]');
  const navH = nav ? nav.getBoundingClientRect().height : 0;
  const y = el.getBoundingClientRect().top + window.pageYOffset - navH - 24;
  window.scrollTo({ top: y, behavior: 'smooth' });
}


type DirtyMap = Record<string, boolean>;

export default function SettingsPage() {
  const [profile, setProfile] = useState<string>('');
  const [originalProfile, setOriginalProfile] = useState<string>('');
  const [analystPrompt, setAnalystPrompt] = useState<string>('');
  const [originalAnalystPrompt, setOriginalAnalystPrompt] = useState<string>('');
  const [evaluatorPrompt, setEvaluatorPrompt] = useState<string>('');
  const [originalEvaluatorPrompt, setOriginalEvaluatorPrompt] = useState<string>('');
  const [analystIsOverride, setAnalystIsOverride] = useState<boolean>(false);
  const [evaluatorIsOverride, setEvaluatorIsOverride] = useState<boolean>(false);
  const [config, setConfig] = useState<ScoringConfig>(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState<ScoringConfig>(DEFAULT_CONFIG);

  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);

  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [savingAnalyst, setSavingAnalyst] = useState<boolean>(false);
  const [savingEvaluator, setSavingEvaluator] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);

  const [profileResult, setProfileResult] = useState<SaveResultData | null>(null);
  const [analystResult, setAnalystResult] = useState<SaveResultData | null>(null);
  const [evaluatorResult, setEvaluatorResult] = useState<SaveResultData | null>(null);
  const [configResult, setConfigResult] = useState<SaveResultData | null>(null);

  const [confirmReset, setConfirmReset] = useState<'analyst' | 'evaluator' | null>(null);
  const [confirmUnsafeSave, setConfirmUnsafeSave] = useState<boolean>(false);

  const profileQuery = useProfile();
  const saveProfileMutation = useSaveProfile();
  const [initialized, setInitialized] = useState(false);

  // Reset all editor state (and its "original" baseline) from a profile
  // response. Used on first load and after a history restore.
  function applyProfileData(data: ProfileResponse): void {
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

    setLastUpdated(data?.updated_at ?? null);
    if (data?.scoring_config) {
      const merged = mergeScoringConfig(data.scoring_config);
      setConfig(merged);
      setOriginalConfig(merged);
    }
  }

  useEffect(() => {
    if (profileQuery.data && !initialized) {
      applyProfileData(profileQuery.data as ProfileResponse);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQuery.data, initialized]);

  const loading = profileQuery.isLoading;
  const error = profileQuery.error?.message ?? null;

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

  const isProfileDirty = profile !== originalProfile;
  const isAnalystDirty = analystPrompt !== originalAnalystPrompt;
  const isEvaluatorDirty = evaluatorPrompt !== originalEvaluatorPrompt;
  const isConfigDirty = JSON.stringify(config) !== JSON.stringify(originalConfig);
  async function saveField(
    body: Record<string, unknown>,
    setSaving: React.Dispatch<React.SetStateAction<boolean>>,
    setResult: React.Dispatch<React.SetStateAction<SaveResultData | null>>,
    onSuccess: (data: ProfileResponse) => void,
    label: string,
  ): Promise<void> {
    setSaving(true);
    setResult(null);
    try {
      const data = await saveProfileMutation.mutateAsync(body) as ProfileResponse;
      setLastUpdated(data?.updated_at ?? null);
      if (data?.analyst_prompt_is_override !== undefined) setAnalystIsOverride(!!data.analyst_prompt_is_override);
      if (data?.evaluator_prompt_is_override !== undefined) setEvaluatorIsOverride(!!data.evaluator_prompt_is_override);
      onSuccess(data);
      setResult({ type: 'success', message: `${label} saved successfully` });
    } catch (e) {
      setResult({ type: 'error', message: `Error saving: ${(e as Error).message}` });
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
    (data: ProfileResponse) => {
      const v = data?.analyst_prompt || '';
      setAnalystPrompt(v);
      setOriginalAnalystPrompt(v);
    },
    'Analyst prompt',
  );

  const saveEvaluator = () => saveField(
    { evaluator_prompt: evaluatorPrompt },
    setSavingEvaluator, setEvaluatorResult,
    (data: ProfileResponse) => {
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
    (data: ProfileResponse) => {
      if (data?.scoring_config) {
        const merged = mergeScoringConfig(data.scoring_config);
        setConfig(merged);
        setOriginalConfig(merged);
      }
    },
    'Analysis config',
  );

  function confirmResetAccept(): void {
    if (confirmReset === 'analyst') {
      saveField(
        { analyst_prompt: '' },
        setSavingAnalyst, setAnalystResult,
        (data: ProfileResponse) => {
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
        (data: ProfileResponse) => {
          const v = data?.evaluator_prompt || '';
          setEvaluatorPrompt(v);
          setOriginalEvaluatorPrompt(v);
        },
        'Evaluator prompt reset',
      );
    }
    setConfirmReset(null);
  }

  function updateConfig(path: string, value: ConfigValue): void {
    setConfig(prev => {
      if (!path.includes('.')) return { ...prev, [path]: value };
      const [group, key] = path.split('.') as ['analyst' | 'evaluator' | 'verdict_bands', string];
      return { ...prev, [group]: { ...(prev[group] as unknown as Record<string, ConfigValue>), [key]: value } };
    });
    setConfigResult(null);
  }

  const evaluatorPlaceholderStates = useMemo(
    () => placeholderStatus(evaluatorPrompt, [...EVALUATOR_PLACEHOLDERS]),
    [evaluatorPrompt],
  );
  const evaluatorMissingPlaceholder = evaluatorPlaceholderStates.some((p) => !p.present);

  function handleEvaluatorSaveClick(): void {
    if (evaluatorMissingPlaceholder && !confirmUnsafeSave) {
      setConfirmUnsafeSave(true);
      return;
    }
    saveEvaluator();
  }

  const dirtyMap: DirtyMap = {
    '01': isProfileDirty,
    '02': isAnalystDirty,
    '03': isEvaluatorDirty,
    '04': isConfigDirty,
    '05': false,
  };
  const dirtyList = SECTIONS.filter((s) => dirtyMap[s.num]);

  if (loading) return <SettingsLoadingSkeleton />;

  return (
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-14 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 max-sm:px-5 max-sm:pt-10 max-sm:pb-16">
      <FolioRail activeId={activeSection} dirtyMap={dirtyMap} />
      <UnsavedDock dirtyList={dirtyList} />

      <header className="mb-14 relative">
        <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
          <span>Vol. III · The Standards Desk</span>
          <span className="hidden sm:block text-[var(--ed-accent)]">Configuration &amp; house style</span>
        </div>
        <h1 className="ed-display font-black text-[clamp(2.6rem,6.5vw,4.4rem)] leading-[0.9] tracking-[-0.022em] text-[var(--ed-ink)] pt-4">
          Settings
        </h1>
        <p className="mt-3 max-w-[560px] text-[var(--ed-ink-soft)] text-[0.98rem] leading-[1.65]">
          View and edit the inputs for Claude analysis — your professional profile, prompts, and model parameters.
        </p>
        <div className="mt-6 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
      </header>

      {error && (
        <div className="bg-[var(--ed-no)]/[0.07] border border-[var(--ed-no)]/30 py-[0.85rem] px-[1.15rem] mb-8 text-[var(--ed-no)] text-[0.85rem]">
          {error}
        </div>
      )}

      {/* 01 — Profile Editor */}
      <section className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-section-01">
        <SectionHeader
          num="01"
          name="Professional Profile"
          right={<MetaPill>{lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleDateString('en-US')}` : 'Source: local file'}</MetaPill>}
        />
        <p className="text-[0.92rem] text-[var(--ed-ink-soft)] leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          The professional profile sent to Claude for job analysis and matching. Changes take effect immediately after saving.
        </p>
        <textarea
          className={`${EDITOR_CLS} min-h-[420px]`}
          value={profile}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setProfile(e.target.value); setProfileResult(null); }}
          dir="auto"
          spellCheck={false}
        />
        <div className="flex justify-between items-center mt-[1.1rem] pt-4 border-t border-dashed border-[var(--ed-rule)] relative max-sm:flex-col max-sm:gap-3 max-sm:items-stretch">
          <span className={`${META_TEXT} inline-flex items-baseline gap-[0.35rem]`}>
            {profile.length.toLocaleString()} chars
            <span className="ml-2 text-[var(--ed-ink-faint)] text-[0.7rem] tracking-[0.04em] font-normal pl-[0.6rem] border-l border-[var(--ed-rule)]">· ≈{estimateTokens(profile).toLocaleString()} tokens</span>
          </span>
          <div className="flex gap-[0.55rem] max-sm:justify-end max-sm:flex-wrap">
            <HistoryButton field="content" onRestored={applyProfileData} />
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
        setValue={(v: string) => { setAnalystPrompt(v); setAnalystResult(null); }}
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
        candidateConfig={config as unknown as Record<string, unknown>}
        historySlot={<HistoryButton field="analyst_prompt" onRestored={applyProfileData} />}
      />

      {/* 03 — Evaluator Prompt */}
      <PromptSection
        sectionId="settings-section-03"
        num="03"
        name="Evaluator Prompt"
        desc={
          <>
            The instruction for Claude during the evaluation stage — scores fit on a 100-point scale across technology, culture, and role attributes.
            The placeholder <code className="font-code text-[0.82em] py-[0.08em] px-[0.4em] bg-[var(--ed-panel)] border border-[var(--ed-rule)] text-[var(--ed-ink-soft)] isolate">{'{{USER_PROFILE}}'}</code> is replaced with your profile at runtime and must not be removed. The parsed job is supplied separately inside <code className="font-code text-[0.82em] py-[0.08em] px-[0.4em] bg-[var(--ed-panel)] border border-[var(--ed-rule)] text-[var(--ed-ink-soft)] isolate">{'<parsed_job>'}</code> tags in the user message.
          </>
        }
        activeStage="evaluate"
        isOverride={evaluatorIsOverride}
        value={evaluatorPrompt}
        setValue={(v: string) => {
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
        candidateProfile={profile}
        candidateConfig={config as unknown as Record<string, unknown>}
        historySlot={<HistoryButton field="evaluator_prompt" onRestored={applyProfileData} />}
      />

      {/* 04 — Scoring Config */}
      <section className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-section-04" style={{ animationDelay: '0.12s' }}>
        <SectionHeader num="04" name="Analysis Config" />
        <p className="text-[0.92rem] text-[var(--ed-ink-soft)] leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
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
            onChange={(k: string, v: ConfigValue) => updateConfig(`analyst.${k}`, v)}
            idPrefix="cfg-a"
          />
          <RoleConfigPanel
            role="evaluator"
            stage="②"
            titleHe="Evaluator"
            titleEn="Evaluate"
            hint="Deep analysis — score, verdict, and evaluation"
            values={config.evaluator}
            onChange={(k: string, v: ConfigValue) => updateConfig(`evaluator.${k}`, v)}
            idPrefix="cfg-e"
          />
        </div>

        <div className="mt-5 pt-4 border-t border-dashed border-[var(--ed-rule)] max-w-[22rem]">
          <div className="flex flex-col gap-[0.55rem]">
            <label className={FIELD_LABEL} htmlFor="cfg-min-score">
              <span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-accent)] shrink-0" />
              Minimum score to save
            </label>
            <input
              id="cfg-min-score"
              type="number"
              className={FIELD_INPUT}
              value={config.min_score_to_save}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig('min_score_to_save', parseInt(e.target.value) || 70)}
              min="0" max="100" step="5"
            />
            <span className="text-[0.72rem] text-[var(--ed-ink-faint)] mt-[0.3rem] leading-[1.55]">Sets the API <code className="font-code text-[var(--ed-ink-soft)]">shouldApply</code> flag (score ≥ threshold). Note: what the scraper saves to the tracker is also gated by its own per-search threshold and verdict rule.</span>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-dashed border-[var(--ed-rule)]">
          <div className="flex flex-col gap-[0.55rem]">
            <label className={FIELD_LABEL}>
              <span className="w-[3px] h-[3px] rounded-full bg-[var(--ed-accent)] shrink-0" />
              Verdict bands
            </label>
            <span className="text-[0.72rem] text-[var(--ed-ink-faint)] leading-[1.55]">Inclusive lower bound (0–100) for each verdict. Below the “No” bound scores as STRONG_NO; a null score is INSUFFICIENT_DATA.</span>
            <div className="grid grid-cols-4 gap-[0.6rem] mt-[0.4rem] max-[560px]:grid-cols-2">
              {([
                ['strong_yes', 'Strong Yes'],
                ['yes', 'Yes'],
                ['maybe', 'Maybe'],
                ['no', 'No'],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex flex-col gap-[0.3rem]">
                  <label className="text-[0.66rem] text-[var(--ed-ink-soft)] font-medium uppercase tracking-[0.06em]" htmlFor={`cfg-band-${key}`}>{label}</label>
                  <input
                    id={`cfg-band-${key}`}
                    type="number"
                    className={FIELD_INPUT}
                    value={config.verdict_bands[key]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateConfig(`verdict_bands.${key}`, parseInt(e.target.value) || 0)}
                    min="0" max="100" step="5"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end items-center gap-[0.6rem] mt-6 pt-[1.1rem] border-t border-dashed border-[var(--ed-rule)] relative">
          <HistoryButton field="scoring_config" onRestored={applyProfileData} />
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
        <SectionHeader num="05" name="Scoring Structure" />
        <p className="text-[0.92rem] text-[var(--ed-ink-soft)] leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          The total score is divided into three dimensions. Each dimension is composed of several weighted criteria.
        </p>

        {/* Flat three-ink distribution bar (weights 35 / 30 / 35) */}
        <div className="flex h-[10px] overflow-hidden mb-[1.4rem] border border-[var(--ed-rule)]" aria-label="Score distribution">
          <div style={{ flex: 35, background: DIM_INK.technical }} />
          <div className="border-l border-[var(--ed-paper)]" style={{ flex: 30, background: DIM_INK.execution }} />
          <div className="border-l border-[var(--ed-paper)]" style={{ flex: 35, background: DIM_INK.sustainability }} />
        </div>

        <div className="flex flex-col border-t border-[var(--ed-rule-strong)] mb-[1.85rem]">
          <ScoringDimension
            color={DIM_INK.technical}
            name="Technical Fit"
            details="Core Stack 0–20 · System Design 0–15"
            points="35"
          />
          <ScoringDimension
            color={DIM_INK.execution}
            name="Engineering Execution Fit"
            details="Dev Practices 0–15 · Ownership & Delivery 0–15"
            points="30"
          />
          <ScoringDimension
            color={DIM_INK.sustainability}
            name="Sustainability & Pace Fit"
            details="Work-Life 0–15 · Communication 0–10 · Growth 0–10"
            points="35"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-3 border-t border-dashed border-[var(--ed-rule)] mt-2">
          <VerdictItem tone="var(--ed-yes)" strong label="STRONG_YES · 80–100" />
          <VerdictItem tone="var(--ed-yes)" label="YES · 60–79" />
          <VerdictItem tone="var(--ed-gold)" label="MAYBE · 40–59" />
          <VerdictItem tone="var(--ed-no)" label="NO · 20–39" />
          <VerdictItem tone="var(--ed-no)" strong label="STRONG_NO · 0–19" />
        </div>
      </section>

    </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section Header — numbered §-mark used by every section             */
/* ------------------------------------------------------------------ */
function SectionHeader({ num, name, right }: { num: string; name: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-[var(--ed-rule-strong)] relative">
      <span className="absolute bottom-[-2px] left-0 w-12 h-[2px] bg-[var(--ed-accent)]" aria-hidden="true" />
      <span className="ed-display text-[2.6rem] font-black text-[var(--ed-ink-faint)] tracking-[-0.03em] tabular-nums leading-[0.78] shrink-0">{num}</span>
      <span className="ed-display text-[1.6rem] font-semibold text-[var(--ed-ink)] tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">{name}</span>
      {right && <span className="ml-auto mb-[0.25rem]">{right}</span>}
    </div>
  );
}

// Small editorial meta-pill (Updated …, Custom/Default).
function MetaPill({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`inline-block text-[0.6rem] py-[0.24rem] px-[0.6rem] tracking-[0.12em] uppercase font-semibold tabular-nums border ${
        accent
          ? 'text-[var(--ed-accent)] border-[var(--ed-accent)]/35 bg-[var(--ed-accent)]/[0.07]'
          : 'text-[var(--ed-ink-faint)] border-[var(--ed-rule)] bg-[var(--ed-panel)]/40'
      }`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Verdict Item — editorial classification stamp                      */
/* ------------------------------------------------------------------ */
function VerdictItem({ tone, label, strong }: { tone: string; label: string; strong?: boolean }) {
  return (
    <span
      className="inline-flex items-center py-[0.32rem] px-[0.7rem] text-[0.66rem] font-semibold font-code tabular-nums tracking-[0.08em] uppercase border"
      style={{
        color: tone,
        background: `color-mix(in oklab, ${tone} ${strong ? 14 : 7}%, transparent)`,
        borderColor: `color-mix(in oklab, ${tone} ${strong ? 45 : 26}%, transparent)`,
        borderLeft: `2px solid ${tone}`,
      }}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Scoring Dimension                                                  */
/* ------------------------------------------------------------------ */
function ScoringDimension({ color, name, details, points }: { color: string; name: string; details: string; points: string }) {
  return (
    <div className="group grid grid-cols-[auto_1fr_auto] items-center gap-[1.1rem] py-[1.05rem] border-b border-[var(--ed-rule)] transition-colors relative hover:bg-[var(--ed-panel)]/50 max-sm:grid-cols-[auto_1fr] max-sm:row-gap-1">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <div className="flex flex-col gap-[0.15rem] min-w-0">
        <span className="ed-display text-[1.05rem] font-semibold text-[var(--ed-ink)] tracking-[-0.005em]">{name}</span>
        <span className="text-[0.76rem] text-[var(--ed-ink-faint)] font-code tabular-nums tracking-[0.02em] text-left">{details}</span>
      </div>
      <span className="ed-display text-[1.35rem] font-bold tabular-nums tracking-[-0.01em] max-sm:col-start-2 max-sm:justify-self-end" style={{ color }}>
        {points}<small className="text-[0.6rem] text-[var(--ed-ink-faint)] tracking-[0.15em] uppercase font-medium font-code ml-1">pt</small>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Prompt Section                                                     */
/* ------------------------------------------------------------------ */
interface PromptSectionProps {
  sectionId: string;
  num: string;
  name: string;
  desc: React.ReactNode;
  activeStage: 'parse' | 'evaluate';
  isOverride: boolean;
  value: string;
  setValue: (v: string) => void;
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  onResetRequest: () => void;
  confirmingReset: boolean;
  onConfirmResetCancel: () => void;
  onConfirmResetAccept: () => void;
  result: SaveResultData | null;
  editorMinHeight: number;
  placeholders?: PlaceholderState[];
  saveWarning?: boolean;
  confirmUnsafeSave?: boolean;
  onConfirmUnsafeAccept?: () => void;
  onConfirmUnsafeCancel?: () => void;
  sectionIndex: number;
  // Candidate (current edited) profile + scoring config, used by the dry-run
  // test so it reflects unsaved edits. Profile only matters for the evaluator.
  candidateProfile?: string;
  candidateConfig?: Record<string, unknown>;
  historySlot?: React.ReactNode;
}

function PromptSection({
  sectionId, num, name, desc, activeStage, isOverride,
  value, setValue, isDirty, saving,
  onSave, onCancel, onResetRequest,
  confirmingReset, onConfirmResetCancel, onConfirmResetAccept,
  result, editorMinHeight,
  placeholders, saveWarning, confirmUnsafeSave,
  onConfirmUnsafeAccept, onConfirmUnsafeCancel,
  sectionIndex,
  candidateProfile, candidateConfig, historySlot,
}: PromptSectionProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const headings = useMemo(() => detectHeadings(value), [value]);

  const [showTest, setShowTest] = useState(false);
  const [sampleJob, setSampleJob] = useState('');
  const testMutation = useTestPrompt();
  const testResult = testMutation.data as TestPromptResult | undefined;

  function runTest(): void {
    const target = activeStage === 'parse' ? 'analyst' : 'evaluator';
    testMutation.mutate({
      target,
      job_description: sampleJob,
      ...(target === 'analyst'
        ? { analyst_prompt: value }
        : { evaluator_prompt: value, profile: candidateProfile }),
      ...(candidateConfig ? { scoring_config: candidateConfig } : {}),
    });
  }

  const sectionDelays: Record<number, string> = { 1: '0.04s', 2: '0.08s', 3: '0.12s', 4: '0.16s', 5: '0.2s' };

  return (
    <section
      className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300 pl-6 max-sm:pl-[1.15rem]"
      id={sectionId}
      style={{ animationDelay: sectionDelays[sectionIndex] || '0s' }}
    >
      {/* Prompt accent stripe */}
      <span
        className="absolute left-0 top-[0.15rem] bottom-[0.15rem] w-[2px] bg-[var(--ed-accent)] opacity-30"
        aria-hidden="true"
      />

      <SectionHeader
        num={num}
        name={name}
        right={<MetaPill accent={isOverride}>{isOverride ? 'Custom' : 'Default'}</MetaPill>}
      />

      <div
        className="flex items-center gap-4 my-[0.6rem] mb-[1.4rem] py-[0.55rem] px-4 border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 max-w-fit font-code max-sm:flex-col max-sm:items-start max-sm:gap-[0.45rem] max-sm:max-w-full max-sm:px-[0.85rem] max-sm:py-[0.7rem]"
        aria-label="Analysis stages"
      >
        <span className={`inline-flex items-center gap-2 text-[0.78rem] uppercase tracking-[0.08em] transition-colors ${activeStage === 'parse' ? 'text-[var(--ed-ink)] font-semibold' : 'text-[var(--ed-ink-faint)]'}`}>
          <span className={`ed-display text-[1.1rem] leading-none tabular-nums ${activeStage === 'parse' ? 'text-[var(--ed-accent)]' : 'text-[var(--ed-ink-faint)] opacity-50'}`}>①</span>
          <span className={`tabular-nums ${activeStage === 'parse' ? 'border-b-2 border-[var(--ed-accent)] pb-0.5' : ''}`}>Parse · Analyst</span>
        </span>
        <span className="w-[1.6rem] h-px shrink-0 bg-[var(--ed-rule)] max-sm:w-px max-sm:h-4" aria-hidden="true" />
        <span className={`inline-flex items-center gap-2 text-[0.78rem] uppercase tracking-[0.08em] transition-colors ${activeStage === 'evaluate' ? 'text-[var(--ed-ink)] font-semibold' : 'text-[var(--ed-ink-faint)]'}`}>
          <span className={`ed-display text-[1.1rem] leading-none tabular-nums ${activeStage === 'evaluate' ? 'text-[var(--ed-accent)]' : 'text-[var(--ed-ink-faint)] opacity-50'}`}>②</span>
          <span className={`tabular-nums ${activeStage === 'evaluate' ? 'border-b-2 border-[var(--ed-accent)] pb-0.5' : ''}`}>Evaluate · Evaluator</span>
        </span>
      </div>

      <p className="text-[0.92rem] text-[var(--ed-ink-soft)] leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">{desc}</p>

      {placeholders && placeholders.length > 0 && (
        <div className="flex flex-wrap gap-[0.7rem] -mt-2 mb-[1.1rem] p-[0.6rem_0.85rem] border border-dashed border-[var(--ed-rule)] bg-[var(--ed-panel)]/30 max-sm:p-[0.55rem_0.7rem]" role="status" aria-live="polite">
          {placeholders.map(({ token, present }) => (
            <span
              key={token}
              className="inline-flex items-center gap-[0.4rem] py-[0.22rem] px-[0.6rem] font-code text-[0.74rem] tabular-nums tracking-[0.02em] border"
              style={{
                color: present ? 'var(--ed-yes)' : 'var(--ed-no)',
                borderColor: `color-mix(in oklab, ${present ? 'var(--ed-yes)' : 'var(--ed-no)'} 35%, transparent)`,
                background: `color-mix(in oklab, ${present ? 'var(--ed-yes)' : 'var(--ed-no)'} 7%, transparent)`,
              }}
            >
              <span>{token}</span>
              <span className="ed-display text-[0.9rem] leading-none" aria-hidden="true">
                {present ? '✓' : '✗'}
              </span>
              {!present && <span className="text-[0.68rem] tracking-[0.1em] uppercase">missing</span>}
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
              className={`inline-flex items-baseline gap-[0.35rem] py-[0.26rem] px-[0.7rem] border border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink-faint)] font-code text-[0.74rem] tracking-[0.02em] cursor-pointer transition-colors hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)] ${
                h.level === 1 ? 'font-semibold text-[var(--ed-ink)]' : h.level === 2 ? 'font-medium' : 'opacity-[0.78]'
              }`}
              onClick={() => scrollTextareaToOffset(textareaRef.current, h.offset)}
              title={`Jump to "${h.text}"`}
            >
              <span className="text-[0.7rem] text-[var(--ed-accent)] opacity-70 tracking-[-0.05em]" aria-hidden="true">{'#'.repeat(h.level)}</span>
              <span className="tabular-nums">{h.text}</span>
            </button>
          ))}
        </div>
      )}

      {confirmingReset && (
        <div className="flex items-center justify-between gap-5 mb-[0.9rem] p-[0.95rem_1.15rem] animate-in fade-in slide-in-from-top-1 duration-200 flex-wrap bg-[var(--ed-panel)]/40 border border-[var(--ed-rule)] max-sm:flex-col max-sm:items-stretch max-sm:gap-[0.7rem]" role="alertdialog" aria-live="assertive">
          <div className="flex flex-col gap-1 flex-[1_1_260px] min-w-0">
            <strong className="ed-display text-[1.05rem] font-semibold tracking-[-0.005em] text-[var(--ed-ink)]">Reset to default?</strong>
            <span className="text-[0.8rem] leading-[1.6] text-[var(--ed-ink-soft)] max-w-[520px]">
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
        className={EDITOR_CLS}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
        dir="auto"
        spellCheck={false}
        style={{ minHeight: `${editorMinHeight}px` }}
      />

      {confirmUnsafeSave && (
        <div className="flex items-center justify-between gap-5 mt-[0.9rem] p-[0.95rem_1.15rem] animate-in fade-in slide-in-from-top-1 duration-200 flex-wrap bg-[var(--ed-no)]/[0.06] border border-[var(--ed-no)]/30 max-sm:flex-col max-sm:items-stretch max-sm:gap-[0.7rem]" role="alertdialog" aria-live="assertive">
          <div className="flex flex-col gap-1 flex-[1_1_260px] min-w-0">
            <strong className="ed-display text-[1.05rem] font-semibold tracking-[-0.005em] text-[var(--ed-no)]">Missing placeholder in prompt</strong>
            <span className="text-[0.8rem] leading-[1.6] text-[var(--ed-ink-soft)] max-w-[520px]">
              Without the {'{{USER_PROFILE}}'} placeholder Claude will not receive your profile. You can save anyway, but analysis will be broken.
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

      <div className="flex justify-between items-center mt-[1.1rem] pt-4 border-t border-dashed border-[var(--ed-rule)] relative max-sm:flex-col max-sm:gap-3 max-sm:items-stretch">
        <span className={`${META_TEXT} inline-flex items-baseline gap-[0.35rem]`}>
          {(value?.length || 0).toLocaleString()} chars
          <span className="ml-2 text-[var(--ed-ink-faint)] text-[0.7rem] tracking-[0.04em] font-normal pl-[0.6rem] border-l border-[var(--ed-rule)]">· ≈{estimateTokens(value).toLocaleString()} tokens</span>
        </span>
        <div className="flex gap-[0.55rem] max-sm:justify-end max-sm:flex-wrap">
          {historySlot}
          <Button
            variant={showTest ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowTest(v => !v)}
            title="Dry-run this prompt against a sample job without saving"
          >
            {showTest ? 'Hide test' : 'Test prompt'}
          </Button>
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
            className={saveWarning ? 'shadow-[0_0_0_3px_color-mix(in_oklab,var(--ed-no)_30%,transparent)] animate-pulse' : ''}
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

      {showTest && (
        <div className="mt-5 p-[1.1rem_1.25rem] border border-dashed border-[var(--ed-rule)] bg-[var(--ed-panel)]/30 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-baseline justify-between gap-3 mb-[0.6rem] flex-wrap">
            <strong className="ed-display text-[1.05rem] font-semibold tracking-[-0.005em] text-[var(--ed-ink)]">Dry-run test</strong>
            <span className="text-[0.72rem] text-[var(--ed-ink-faint)]">
              Runs the {activeStage === 'parse' ? 'parse' : 'parse (saved analyst) → evaluate'} stage with your unsaved edits. Nothing is saved.
            </span>
          </div>
          <textarea
            className={`${EDITOR_CLS} text-[0.8rem] leading-[1.65] p-[0.9rem_1rem] min-h-[120px]`}
            value={sampleJob}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSampleJob(e.target.value)}
            placeholder="Paste a sample job description to score…"
            dir="auto"
            spellCheck={false}
          />
          <div className="flex items-center gap-[0.6rem] mt-[0.7rem]">
            <Button
              size="sm"
              onClick={runTest}
              disabled={testMutation.isPending || !sampleJob.trim()}
            >
              {testMutation.isPending ? 'Running…' : 'Run test'}
            </Button>
            <span className="text-[0.72rem] text-[var(--ed-ink-faint)] tabular-nums">{sampleJob.length.toLocaleString()} chars</span>
          </div>

          {testMutation.isError && (
            <div className="mt-[0.8rem] p-[0.7rem_0.9rem] bg-[var(--ed-no)]/[0.06] border border-[var(--ed-no)]/30 text-[0.8rem] text-[var(--ed-no)]">
              {(testMutation.error as Error)?.message || 'Test request failed'}
            </div>
          )}

          {testResult && <TestResultPanel result={testResult} />}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Test Result Panel                                                  */
/* ------------------------------------------------------------------ */
function TestResultPanel({ result }: { result: TestPromptResult }) {
  return (
    <div className="mt-[0.9rem] flex flex-col gap-[0.7rem]" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-[0.6rem]">
        {result.stages.map((s) => (
          <span
            key={s.stage}
            className="inline-flex items-center gap-[0.4rem] py-[0.22rem] px-[0.6rem] font-code text-[0.74rem] tracking-[0.02em] border"
            style={{
              color: s.deserializedCleanly ? 'var(--ed-yes)' : 'var(--ed-no)',
              borderColor: `color-mix(in oklab, ${s.deserializedCleanly ? 'var(--ed-yes)' : 'var(--ed-no)'} 35%, transparent)`,
              background: `color-mix(in oklab, ${s.deserializedCleanly ? 'var(--ed-yes)' : 'var(--ed-no)'} 7%, transparent)`,
            }}
          >
            <span className="ed-display text-[0.9rem] leading-none" aria-hidden="true">{s.deserializedCleanly ? '✓' : '✗'}</span>
            <span className="capitalize">{s.stage}</span>
            <span className="opacity-70">{s.deserializedCleanly ? 'parsed' : 'failed'}</span>
          </span>
        ))}
        {typeof result.overallScore === 'number' && (
          <span className="inline-flex items-center gap-[0.4rem] py-[0.22rem] px-[0.75rem] font-code text-[0.74rem] tabular-nums border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 text-[var(--ed-ink)]">
            Score {result.overallScore}
            {result.verdict && <span className="text-[var(--ed-ink-faint)]">· {VERDICT_LABELS[result.verdict] || result.verdict}</span>}
          </span>
        )}
      </div>

      {result.stages.filter((s) => s.error).map((s) => (
        <div key={`${s.stage}-err`} className="p-[0.7rem_0.9rem] bg-[var(--ed-no)]/[0.06] border border-[var(--ed-no)]/30 text-[0.78rem] text-[var(--ed-no)] leading-[1.55]">
          <strong className="font-semibold capitalize">{s.stage} failed:</strong> {s.error}
        </div>
      ))}

      {result.stages.filter((s) => s.rawOutput).map((s) => (
        <details key={`${s.stage}-raw`} className="group">
          <summary className="cursor-pointer text-[0.74rem] text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)] tracking-[0.02em] select-none">
            Raw {s.stage} output
          </summary>
          <pre className="mt-[0.5rem] p-[0.8rem_1rem] bg-[var(--ed-panel)] border border-[var(--ed-rule)] text-[0.74rem] leading-[1.55] overflow-auto max-h-[320px] whitespace-pre-wrap break-words text-[var(--ed-ink-soft)]" dir="ltr">
            {s.rawOutput}
          </pre>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* History Button + dropdown                                          */
/* ------------------------------------------------------------------ */
function HistoryButton({ field, onRestored }: { field: HistoryField; onRestored: (data: ProfileResponse) => void }) {
  return (
    <HistoryDropdown<HistoryField, ProfileResponse>
      field={field}
      onRestored={onRestored}
      useHistory={useProfileHistory}
      useRestore={useRestoreHistory}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Role Config Panel                                                  */
/* ------------------------------------------------------------------ */
interface RoleConfigPanelProps {
  role: 'analyst' | 'evaluator';
  stage: string;
  titleHe: string;
  titleEn: string;
  hint: string;
  values: RoleConfig;
  onChange: (key: string, value: ConfigValue) => void;
  idPrefix: string;
}

function RoleConfigPanel({ role, stage, titleHe, titleEn, hint, values, onChange, idPrefix }: RoleConfigPanelProps) {
  const modelId = `${idPrefix}-model`;
  const tempId = `${idPrefix}-temp`;
  const tokensId = `${idPrefix}-tokens`;
  const thinkId = `${idPrefix}-thinking`;
  const budgetId = `${idPrefix}-thinking-budget`;

  const roleColor = role === 'analyst' ? DIM_INK.technical : DIM_INK.execution;
  const roleColorSoft = `color-mix(in oklab, ${roleColor} 9%, transparent)`;
  const roleColorRing = `color-mix(in oklab, ${roleColor} 32%, transparent)`;

  const focusOn = (el: HTMLElement) => { el.style.borderColor = roleColor; el.style.boxShadow = `0 0 0 3px ${roleColorSoft}`; };
  const focusOff = (el: HTMLElement) => { el.style.borderColor = ''; el.style.boxShadow = ''; };

  return (
    <div
      className="flex flex-col gap-[0.95rem] p-[1.35rem_1.4rem_1.2rem] border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 relative overflow-hidden transition-colors"
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.borderColor = roleColorRing; }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.borderColor = ''; }}
    >
      {/* Top accent stripe */}
      <span
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, ${roleColor} 0%, transparent 100%)` }}
      />

      <div className="flex flex-col gap-[0.4rem] pb-[0.85rem] border-b border-dashed border-[var(--ed-rule)] relative">
        <div className="flex items-center gap-[0.65rem]">
          <span className="ed-display text-[1.4rem] leading-none font-bold shrink-0 tabular-nums" style={{ color: roleColor }}>{stage}</span>
          <h3 className="inline-flex items-baseline gap-2 text-[0.95rem] text-[var(--ed-ink)] ed-display font-semibold m-0 tracking-[-0.005em] flex-1 min-w-0">
            <span>{titleHe}</span>
            <span className="text-[var(--ed-ink-faint)] font-normal text-[0.85em]" aria-hidden="true">·</span>
            <span className="font-code text-[0.7rem] tracking-[0.22em] uppercase font-semibold" style={{ color: roleColor }}>{titleEn}</span>
          </h3>
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: roleColor, boxShadow: `0 0 0 3px ${roleColorSoft}` }}
            aria-hidden="true"
          />
        </div>
        <p className="text-[0.78rem] text-[var(--ed-ink-faint)] leading-[1.55] m-0 pl-[2rem]">{hint}</p>
      </div>

      <div className="flex flex-col gap-[0.95rem]">
        <div className="flex flex-col gap-[0.55rem]">
          <label className={FIELD_LABEL} htmlFor={modelId}>
            <span className="w-[3px] h-[3px] rounded-full shrink-0" style={{ background: roleColor }} />
            Claude Model
          </label>
          <select
            id={modelId}
            className={FIELD_INPUT}
            value={values.model}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange('model', e.target.value)}
            onFocus={(e) => focusOn(e.target)}
            onBlur={(e) => focusOff(e.target)}
          >
            {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-[0.55rem]">
          <label className={FIELD_LABEL} htmlFor={tempId}>
            <span className="w-[3px] h-[3px] rounded-full shrink-0" style={{ background: roleColor }} />
            Temperature
          </label>
          <input
            id={tempId}
            type="number"
            className={FIELD_INPUT}
            value={values.temperature}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('temperature', parseFloat(e.target.value) || 0)}
            min="0" max="1" step="0.1"
            disabled={values.thinking_enabled}
            onFocus={(e) => focusOn(e.target)}
            onBlur={(e) => focusOff(e.target)}
          />
        </div>

        <div className="flex flex-col gap-[0.55rem]">
          <label className={FIELD_LABEL} htmlFor={tokensId}>
            <span className="w-[3px] h-[3px] rounded-full shrink-0" style={{ background: roleColor }} />
            Max Tokens
          </label>
          <input
            id={tokensId}
            type="number"
            className={FIELD_INPUT}
            value={values.max_tokens}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('max_tokens', parseInt(e.target.value) || 1024)}
            min="512" max="16384" step="512"
            onFocus={(e) => focusOn(e.target)}
            onBlur={(e) => focusOff(e.target)}
          />
        </div>

        <div className="flex flex-col gap-[0.55rem]">
          <label className={FIELD_LABEL} htmlFor={thinkId}>
            <span className="w-[3px] h-[3px] rounded-full shrink-0" style={{ background: roleColor }} />
            Extended Thinking
          </label>
          <select
            id={thinkId}
            className={FIELD_INPUT}
            value={values.thinking_enabled ? 'on' : 'off'}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange('thinking_enabled', e.target.value === 'on')}
            onFocus={(e) => focusOn(e.target)}
            onBlur={(e) => focusOff(e.target)}
          >
            <option value="on">Enabled (temperature=1)</option>
            <option value="off">Disabled</option>
          </select>
        </div>

        <div className="flex flex-col gap-[0.55rem]">
          <label className={FIELD_LABEL} htmlFor={budgetId}>
            <span className="w-[3px] h-[3px] rounded-full shrink-0" style={{ background: roleColor }} />
            Thinking Budget · tokens
          </label>
          <input
            id={budgetId}
            type="number"
            className={FIELD_INPUT}
            value={values.thinking_budget}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange('thinking_budget', parseInt(e.target.value) || 2048)}
            min="1024" max="16000" step="512"
            disabled={!values.thinking_enabled}
            onFocus={(e) => focusOn(e.target)}
            onBlur={(e) => focusOff(e.target)}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Folio Rail                                                         */
/* ------------------------------------------------------------------ */
function FolioRail({ activeId, dirtyMap }: { activeId: string; dirtyMap: DirtyMap }) {
  return (
    <aside className="hidden xl:block fixed top-1/2 left-7 -translate-y-1/2 z-40 w-[108px] py-5 px-3 font-code animate-in fade-in slide-in-from-left-2 duration-500 pointer-events-auto" aria-label="Page navigation">
      {/* Vertical line */}
      <span className="absolute top-0 bottom-0 right-0 w-px bg-[var(--ed-rule)]" aria-hidden="true" />
      <div className="ed-display text-[1.4rem] text-[var(--ed-ink-faint)] text-left mb-4 pl-1" aria-hidden="true">§</div>
      <ol className="list-none m-0 p-0 flex flex-col gap-[0.1rem]">
        {SECTIONS.map((s) => {
          const isActive = activeId === s.id;
          const isDirty = dirtyMap[s.num];
          return (
            <li key={s.id} className="m-0">
              <button
                type="button"
                className={`grid grid-cols-[auto_14px_1fr_auto] items-center gap-[0.55rem] w-full py-2 px-[0.35rem] bg-transparent border-none cursor-pointer text-left transition-all relative hover:translate-x-[2px] ${
                  isActive ? 'text-[var(--ed-ink)]' : 'text-[var(--ed-ink-faint)] hover:text-[var(--ed-ink)]'
                }`}
                onClick={() => scrollToSection(s.id)}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`${s.num} — ${s.name}${isDirty ? ' (unsaved)' : ''}`}
              >
                <span className={`ed-display font-semibold tabular-nums leading-none min-w-[1.6ch] transition-all ${
                  isActive ? 'text-[1.15rem] text-[var(--ed-ink)]' : 'text-[0.9rem]'
                }`} style={{ color: isActive ? undefined : 'inherit' }}>{s.num}</span>
                <span
                  className={`h-px transition-all ${isActive ? 'w-[14px] opacity-100 bg-[var(--ed-accent)] h-0.5' : 'w-2 opacity-40 bg-current'}`}
                  aria-hidden="true"
                />
                <span className={`text-[0.64rem] tracking-[0.18em] uppercase font-semibold whitespace-nowrap transition-all ${
                  isActive ? 'opacity-100 text-[var(--ed-ink)]' : 'opacity-70'
                }`} style={{ color: isActive ? undefined : 'inherit' }}>{s.short}</span>
                {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-[var(--ed-accent)] shrink-0 animate-pulse" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 pl-[0.35rem] flex items-baseline gap-[0.2rem] font-code text-[0.66rem] text-[var(--ed-ink-faint)] tracking-[0.1em] tabular-nums opacity-70" aria-hidden="true">
        <span>{SECTIONS.length.toString().padStart(2, '0')}</span>
        <span className="opacity-60">/</span>
        <span>{SECTIONS.length.toString().padStart(2, '0')}</span>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Unsaved Dock                                                       */
/* ------------------------------------------------------------------ */
function UnsavedDock({ dirtyList }: { dirtyList: SectionInfo[] }) {
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
        className="flex items-center gap-4 py-[0.65rem] pr-3 pl-4 backdrop-blur-[20px] border border-[var(--ed-rule-strong)] flex-wrap max-[860px]:p-[0.5rem_0.65rem_0.5rem_0.85rem] max-[860px]:gap-[0.7rem]"
        style={{
          background: 'color-mix(in oklab, var(--ed-paper) 88%, transparent)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.25)',
          backdropFilter: 'blur(20px) saturate(1.25)',
          boxShadow: '0 18px 48px rgba(0,0,0,0.10)',
        }}
      >
        <div className="inline-flex items-center gap-[0.55rem] pr-[0.9rem] border-r border-[var(--ed-rule)] font-code text-[0.8rem] text-[var(--ed-ink)] font-medium max-[860px]:pr-[0.7rem] max-[860px]:text-[0.74rem]">
          <span className="w-2 h-2 rounded-full bg-[var(--ed-gold)] relative shrink-0">
            <span className="absolute inset-[-4px] rounded-full bg-[var(--ed-gold)] opacity-30 animate-pulse" />
          </span>
          <span className="ed-display text-[1.1rem] font-bold text-[var(--ed-ink)] leading-none tabular-nums">{dirtyList.length}</span>
          <span className="text-[var(--ed-ink-faint)] tracking-[0.01em] uppercase text-[0.66rem] font-semibold">
            {dirtyList.length === 1 ? 'unsaved change' : 'unsaved changes'}
          </span>
        </div>
        <div className="inline-flex items-center gap-[0.4rem] flex-wrap max-[860px]:gap-[0.3rem]">
          {dirtyList.map((s) => (
            <button
              key={s.id}
              type="button"
              className="inline-flex items-center gap-[0.4rem] py-[0.34rem] pr-[0.85rem] pl-[0.5rem] border border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink-soft)] font-code text-[0.72rem] font-semibold uppercase tracking-[0.06em] cursor-pointer transition-colors hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)] max-[860px]:pr-[0.7rem] max-[860px]:pl-[0.4rem]"
              onClick={() => scrollToSection(s.id)}
              title={`Jump to ${s.name}`}
            >
              <span className="ed-display font-bold text-[var(--ed-ink)] tabular-nums py-[0.05rem] px-[0.4rem] bg-[var(--ed-panel)] border border-[var(--ed-rule)] text-[0.7rem] leading-[1.3]">{s.num}</span>
              <span className="max-[860px]:hidden normal-case tracking-[0.02em]">{s.name}</span>
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
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-14 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 max-sm:px-5" role="status" aria-live="polite" aria-label="Loading settings">
      <header className="mb-12 relative" aria-hidden="true">
        <div className="pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">Vol. III · The Standards Desk</div>
        <h1 className="ed-display text-[clamp(2.6rem,6.5vw,4.4rem)] font-black text-[var(--ed-ink)] leading-[0.9] pt-4 mb-4 tracking-[-0.022em] animate-in fade-in duration-300">
          Settings
        </h1>
        <Skeleton className="w-[62%] h-[14px] rounded-[4px] mt-2" />
        <div className="mt-[1.4rem] border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
      </header>

      {/* Section ghost - profile editor */}
      <section
        className="mb-10 pb-8 border-b border-[var(--ed-rule)] animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: '280ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-[0.85rem] mb-4">
          <span className="ed-display text-[2.4rem] font-black text-[var(--ed-ink-faint)] tracking-[-0.03em] leading-none tabular-nums relative">
            01
            <span className="absolute bottom-[-0.35rem] left-0 w-[2rem] h-[2px] bg-[var(--ed-accent)]" />
          </span>
          <Skeleton className="w-[160px] h-5 rounded-[4px]" />
          <Skeleton className="w-[92px] h-[18px] rounded-[4px] ml-auto max-[720px]:hidden" />
        </div>
        <Skeleton className="w-[68%] h-3 rounded-[4px]" />
        {/* Editor preview */}
        <div className="relative bg-[var(--ed-panel)]/40 border border-[var(--ed-rule)] p-[1.2rem_1.25rem_1.35rem] pl-12 mt-4 overflow-hidden">
          <div className="absolute inset-0 right-auto w-9 bg-[var(--ed-panel)]/60 border-r border-[var(--ed-rule)] flex flex-col justify-around py-[0.9rem]">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <span key={i} className="block w-[0.45rem] h-px bg-[var(--ed-ink-faint)]/40 ml-auto mr-[0.45rem]" />
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
          <span className="ed-display text-[2.4rem] font-black text-[var(--ed-ink-faint)] tracking-[-0.03em] leading-none tabular-nums relative">
            04
            <span className="absolute bottom-[-0.35rem] left-0 w-[2rem] h-[2px] bg-[var(--ed-accent)]" />
          </span>
          <Skeleton className="w-[160px] h-5 rounded-[4px]" />
        </div>
        <div className="grid grid-cols-2 gap-[1.35rem] mt-4 max-[720px]:grid-cols-1">
          {/* Analyst panel */}
          <div className="bg-[var(--ed-panel)]/40 border border-[var(--ed-rule)] p-[1.4rem_1.35rem_1.2rem] flex flex-col gap-[0.85rem] relative overflow-hidden">
            <span className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${DIM_INK.technical}, transparent)` }} />
            <div className="flex items-center gap-[0.65rem] pb-[0.65rem] border-b border-dashed border-[var(--ed-rule)]">
              <span className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: DIM_INK.technical }} />
              <Skeleton className="flex-1 max-w-[140px] h-[14px] rounded-[4px]" />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[0.4rem]">
                <Skeleton className="w-[48%] h-[10px] rounded-[3px]" />
                <Skeleton className="w-full h-[34px] rounded-[4px]" />
              </div>
            ))}
          </div>
          {/* Evaluator panel */}
          <div className="bg-[var(--ed-panel)]/40 border border-[var(--ed-rule)] p-[1.4rem_1.35rem_1.2rem] flex flex-col gap-[0.85rem] relative overflow-hidden">
            <span className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${DIM_INK.execution}, transparent)` }} />
            <div className="flex items-center gap-[0.65rem] pb-[0.65rem] border-b border-dashed border-[var(--ed-rule)]">
              <span className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: DIM_INK.execution }} />
              <Skeleton className="flex-1 max-w-[140px] h-[14px] rounded-[4px]" />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-[0.4rem]">
                <Skeleton className="w-[48%] h-[10px] rounded-[3px]" />
                <Skeleton className="w-full h-[34px] rounded-[4px]" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cycling subtitle */}
      <div className="mt-11 pt-[1.4rem] border-t border-dashed border-[var(--ed-rule)] flex items-center gap-[0.7rem] ed-display text-[1rem] text-[var(--ed-ink-faint)] italic tracking-[-0.005em] relative">
        <span className="ed-display text-[1.2rem] text-[var(--ed-accent)] opacity-80 not-italic" aria-hidden="true">§</span>
        <span aria-hidden="true">Loading...</span>
        <span className="sr-only">Loading settings</span>
      </div>
    </div>
    </div>
  );
}
