import { useState, useEffect, useRef, useMemo } from 'react';
import { profileApi } from '../../utils/api';
import '../../styles/settings.css';

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

  if (loading) return <div className="settings-page"><p className="empty-state">טוען הגדרות...</p></div>;

  return (
    <div className="settings-page">
      <header className="settings-hero">
        <span className="settings-hero__eyebrow">Configuration · 2026</span>
        <h1 className="settings-hero__title">הגדרות</h1>
        <p className="settings-hero__sub">
          צפייה ועריכה של נתוני הקלט לניתוח Claude — הפרופיל המקצועי, הפרומפטים ופרמטרי המודל.
        </p>
        <hr className="settings-hero__rule" />
      </header>

      {error && <div className="settings-error">{error}</div>}

      {/* 01 — Profile Editor */}
      <section className="settings-section">
        <div className="settings-section__label">
          <span className="settings-section__num">01</span>
          <span className="settings-section__name">פרופיל מקצועי</span>
          <span className="settings-section__badge">
            {lastUpdated
              ? `עודכן ${new Date(lastUpdated).toLocaleDateString('he-IL')}`
              : 'מקור: קובץ מקומי'}
          </span>
        </div>
        <p className="settings-section__desc">
          הפרופיל המקצועי שנשלח ל-Claude לצורך ניתוח והתאמת משרות. השינויים נכנסים לתוקף מיידית לאחר שמירה.
        </p>
        <textarea
          className="settings-editor"
          value={profile}
          onChange={(e) => { setProfile(e.target.value); setProfileResult(null); }}
          dir="auto"
          spellCheck={false}
        />
        <div className="settings-editor__footer">
          <span className="settings-editor__count">
            {profile.length.toLocaleString()} תווים
            <span className="settings-editor__tokens">· ≈{estimateTokens(profile).toLocaleString()} tokens</span>
          </span>
          <div className="settings-editor__actions">
            {isProfileDirty && (
              <button className="btn btn-secondary btn-sm" onClick={() => setProfile(originalProfile)} disabled={savingProfile}>
                ביטול שינויים
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={saveProfile}
              disabled={savingProfile || !isProfileDirty}
            >
              {savingProfile ? 'שומר...' : 'שמור פרופיל'}
            </button>
          </div>
        </div>
        {profileResult && (
          <div className={`save-result ${profileResult.type}`}>{profileResult.message}</div>
        )}
      </section>

      {/* 02 — Analyst Prompt */}
      <PromptSection
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
      />

      {/* 03 — Evaluator Prompt */}
      <PromptSection
        num="03"
        name="פרומפט הערכה"
        desc={
          <>
            ההנחיה ל-Claude בשלב ההערכה — מדרג התאמה במאה נקודות לפי טכנולוגיה, תרבות ומאפייני תפקיד.
            שני הפלייסהולדרים <code>{'{{USER_PROFILE}}'}</code> ו-<code>{'{{PARSED_JOB}}'}</code> מוחלפים בזמן ריצה ואסור למחוק אותם.
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
      />

      {/* 04 — Scoring Config */}
      <section className="settings-section">
        <div className="settings-section__label">
          <span className="settings-section__num">04</span>
          <span className="settings-section__name">תצורת ניתוח</span>
        </div>
        <p className="settings-section__desc">
          כל שלב בצנרת מוגדר בנפרד — האנליסט (שלב הפרסינג) וההערכה (שלב הציון).
          חשיבה מורחבת מאלצת טמפרטורה של 1.
        </p>

        <div className="role-configs">
          <RoleConfigPanel
            title="① אנליסט · Parse"
            hint="קל ומהיר — חילוץ שדות מתיאור משרה"
            values={config.analyst}
            onChange={(k, v) => updateConfig(`analyst.${k}`, v)}
            idPrefix="cfg-a"
          />
          <RoleConfigPanel
            title="② הערכה · Evaluate"
            hint="ניתוח עמוק — ציון, ברדיקט והערכה בעברית"
            values={config.evaluator}
            onChange={(k, v) => updateConfig(`evaluator.${k}`, v)}
            idPrefix="cfg-e"
          />
        </div>

        <div className="config-global">
          <div className="config-item">
            <label className="config-item__label" htmlFor="cfg-min-score">ציון מינימום לשמירה</label>
            <input
              id="cfg-min-score"
              type="number"
              className="config-item__input"
              value={config.min_score_to_save}
              onChange={(e) => updateConfig('min_score_to_save', parseInt(e.target.value) || 70)}
              min="0" max="100" step="5"
            />
            <span className="config-item__help">סף אחד לצנרת כולה — חל על תוצאות ההערכה</span>
          </div>
        </div>

        <div className="settings-actions">
          {isConfigDirty && (
            <button className="btn btn-secondary btn-sm" onClick={() => setConfig(originalConfig)} disabled={savingConfig}>
              ביטול שינויים
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={saveConfig}
            disabled={savingConfig || !isConfigDirty}
          >
            {savingConfig ? 'שומר...' : 'שמור תצורה'}
          </button>
        </div>
        {configResult && (
          <div className={`save-result ${configResult.type}`}>{configResult.message}</div>
        )}
      </section>

      {/* 05 — Scoring Structure */}
      <section className="settings-section">
        <div className="settings-section__label">
          <span className="settings-section__num">05</span>
          <span className="settings-section__name">מבנה ניתוח</span>
        </div>
        <p className="settings-section__desc">
          הציון הכולל מתחלק לשלושה ממדים. כל ממד מורכב ממספר קריטריונים משוקללים.
        </p>

        <div className="scoring-bar" aria-label="התפלגות ציון">
          <div className="scoring-bar__segment scoring-bar__segment--tech" style={{ flex: 35 }} />
          <div className="scoring-bar__segment scoring-bar__segment--culture" style={{ flex: 35 }} />
          <div className="scoring-bar__segment scoring-bar__segment--role" style={{ flex: 30 }} />
        </div>

        <div className="scoring-overview">
          <div className="scoring-dimension scoring-dimension--tech">
            <span className="scoring-dimension__marker" />
            <div className="scoring-dimension__body">
              <span className="scoring-dimension__name">התאמה טכנית</span>
              <span className="scoring-dimension__details">Core Stack 0–20 · System Design 0–15</span>
            </div>
            <span className="scoring-dimension__points">35<small>pt</small></span>
          </div>
          <div className="scoring-dimension scoring-dimension--culture">
            <span className="scoring-dimension__marker" />
            <div className="scoring-dimension__body">
              <span className="scoring-dimension__name">התאמה תרבותית</span>
              <span className="scoring-dimension__details">Work Style 0–15 · Communication 0–10 · Ownership 0–10</span>
            </div>
            <span className="scoring-dimension__points">35<small>pt</small></span>
          </div>
          <div className="scoring-dimension scoring-dimension--role">
            <span className="scoring-dimension__marker" />
            <div className="scoring-dimension__body">
              <span className="scoring-dimension__name">מאפייני התפקיד</span>
              <span className="scoring-dimension__details">Problem Domain 0–15 · Pace 0–10 · Growth 0–5</span>
            </div>
            <span className="scoring-dimension__points">30<small>pt</small></span>
          </div>
        </div>

        <div className="verdict-legend">
          <span className="verdict-item verdict-strong-yes">STRONG_YES · 80–100</span>
          <span className="verdict-item verdict-yes">YES · 60–79</span>
          <span className="verdict-item verdict-maybe">MAYBE · 40–59</span>
          <span className="verdict-item verdict-no">NO · 20–39</span>
          <span className="verdict-item verdict-strong-no">STRONG_NO · 0–19</span>
        </div>
      </section>
    </div>
  );
}

function PromptSection({
  num, name, desc, activeStage, isOverride,
  value, setValue, isDirty, saving,
  onSave, onCancel, onResetRequest,
  confirmingReset, onConfirmResetCancel, onConfirmResetAccept,
  result, editorMinHeight,
  placeholders, saveWarning, confirmUnsafeSave,
  onConfirmUnsafeAccept, onConfirmUnsafeCancel,
}) {
  const textareaRef = useRef(null);
  const headings = useMemo(() => detectHeadings(value), [value]);

  return (
    <section className="settings-section settings-section--prompt">
      <div className="settings-section__label">
        <span className="settings-section__num">{num}</span>
        <span className="settings-section__name">{name}</span>
        <span className={`settings-section__badge ${isOverride ? 'settings-section__badge--override' : ''}`}>
          {isOverride ? 'מותאם אישית' : 'ברירת מחדל'}
        </span>
      </div>

      <div className="pipeline-ribbon" aria-label="שלבי ניתוח">
        <span className={`pipeline-ribbon__stage ${activeStage === 'parse' ? 'pipeline-ribbon__stage--active' : ''}`}>
          <span className="pipeline-ribbon__num">①</span>
          <span className="pipeline-ribbon__label">Parse · אנליסט</span>
        </span>
        <span className="pipeline-ribbon__arrow" aria-hidden="true" />
        <span className={`pipeline-ribbon__stage ${activeStage === 'evaluate' ? 'pipeline-ribbon__stage--active' : ''}`}>
          <span className="pipeline-ribbon__num">②</span>
          <span className="pipeline-ribbon__label">Evaluate · הערכה</span>
        </span>
      </div>

      <p className="settings-section__desc">{desc}</p>

      {placeholders && placeholders.length > 0 && (
        <div className="prompt-placeholders" role="status" aria-live="polite">
          {placeholders.map(({ token, present }) => (
            <span
              key={token}
              className={`prompt-placeholders__item ${present ? '' : 'prompt-placeholders__item--missing'}`}
            >
              <span className="prompt-placeholders__token">{token}</span>
              <span className="prompt-placeholders__mark" aria-hidden="true">
                {present ? '✓' : '✗'}
              </span>
              {!present && <span className="prompt-placeholders__missing-label">חסר</span>}
            </span>
          ))}
        </div>
      )}

      {headings.length > 0 && (
        <div className="prompt-outline" aria-label="מבנה הפרומפט">
          {headings.map((h, i) => (
            <button
              key={`${h.offset}-${i}`}
              type="button"
              className={`prompt-outline__heading prompt-outline__heading--l${Math.min(h.level, 3)}`}
              onClick={() => scrollTextareaToOffset(textareaRef.current, h.offset)}
              title={`קפוץ אל "${h.text}"`}
            >
              <span className="prompt-outline__hash" aria-hidden="true">{'#'.repeat(h.level)}</span>
              <span className="prompt-outline__name">{h.text}</span>
            </button>
          ))}
        </div>
      )}

      {confirmingReset && (
        <div className="inline-confirm inline-confirm--reset" role="alertdialog" aria-live="assertive">
          <div className="inline-confirm__body">
            <strong className="inline-confirm__title">לאפס לברירת מחדל?</strong>
            <span className="inline-confirm__text">
              הפרומפט המותאם אישית יימחק ויוחלף בברירת המחדל המצורפת לשירות. פעולה זו לא ניתנת לביטול.
            </span>
          </div>
          <div className="inline-confirm__actions">
            <button className="btn btn-secondary btn-sm" onClick={onConfirmResetCancel} disabled={saving}>
              ביטול
            </button>
            <button className="btn btn-danger btn-sm" onClick={onConfirmResetAccept} disabled={saving}>
              {saving ? 'מאפס...' : 'כן, אפס'}
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className="settings-editor"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        dir="auto"
        spellCheck={false}
        style={{ minHeight: `${editorMinHeight}px` }}
      />

      {confirmUnsafeSave && (
        <div className="inline-confirm inline-confirm--unsafe" role="alertdialog" aria-live="assertive">
          <div className="inline-confirm__body">
            <strong className="inline-confirm__title">חסר פלייסהולדר בפרומפט</strong>
            <span className="inline-confirm__text">
              ללא הפלייסהולדרים Claude לא יקבל את הפרופיל או את פרטי המשרה. אפשר לשמור בכל זאת, אך הניתוח יהיה שבור.
            </span>
          </div>
          <div className="inline-confirm__actions">
            <button className="btn btn-secondary btn-sm" onClick={onConfirmUnsafeCancel} disabled={saving}>
              ביטול
            </button>
            <button className="btn btn-danger btn-sm" onClick={onConfirmUnsafeAccept} disabled={saving}>
              {saving ? 'שומר...' : 'שמור בכל זאת'}
            </button>
          </div>
        </div>
      )}

      <div className="settings-editor__footer">
        <span className="settings-editor__count">
          {(value?.length || 0).toLocaleString()} תווים
          <span className="settings-editor__tokens">· ≈{estimateTokens(value).toLocaleString()} tokens</span>
        </span>
        <div className="settings-editor__actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={onResetRequest}
            disabled={saving || confirmingReset}
            title="אפס לברירת המחדל המצורפת לשירות"
          >
            אפס לברירת מחדל
          </button>
          {isDirty && (
            <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={saving}>
              ביטול שינויים
            </button>
          )}
          <button
            className={`btn btn-primary ${saveWarning ? 'btn-primary--warning' : ''}`}
            onClick={onSave}
            disabled={saving || !isDirty}
            title={saveWarning ? 'חסר פלייסהולדר — יידרש אישור נוסף' : undefined}
          >
            {saving ? 'שומר...' : 'שמור פרומפט'}
          </button>
        </div>
      </div>

      {result && (
        <div className={`save-result ${result.type}`}>{result.message}</div>
      )}
    </section>
  );
}

function RoleConfigPanel({ title, hint, values, onChange, idPrefix }) {
  const modelId = `${idPrefix}-model`;
  const tempId = `${idPrefix}-temp`;
  const tokensId = `${idPrefix}-tokens`;
  const thinkId = `${idPrefix}-thinking`;
  const budgetId = `${idPrefix}-thinking-budget`;

  return (
    <div className="role-config">
      <div className="role-config__head">
        <h3 className="role-config__title">{title}</h3>
        <p className="role-config__hint">{hint}</p>
      </div>

      <div className="config-grid">
        <div className="config-item">
          <label className="config-item__label" htmlFor={modelId}>מודל Claude</label>
          <select
            id={modelId}
            className="config-item__select"
            value={values.model}
            onChange={(e) => onChange('model', e.target.value)}
          >
            {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="config-item">
          <label className="config-item__label" htmlFor={tempId}>טמפרטורה</label>
          <input
            id={tempId}
            type="number"
            className="config-item__input"
            value={values.temperature}
            onChange={(e) => onChange('temperature', parseFloat(e.target.value) || 0)}
            min="0" max="1" step="0.1"
            disabled={values.thinking_enabled}
          />
        </div>

        <div className="config-item">
          <label className="config-item__label" htmlFor={tokensId}>Max Tokens</label>
          <input
            id={tokensId}
            type="number"
            className="config-item__input"
            value={values.max_tokens}
            onChange={(e) => onChange('max_tokens', parseInt(e.target.value) || 1024)}
            min="512" max="16384" step="512"
          />
        </div>

        <div className="config-item">
          <label className="config-item__label" htmlFor={thinkId}>חשיבה מורחבת</label>
          <select
            id={thinkId}
            className="config-item__select"
            value={values.thinking_enabled ? 'on' : 'off'}
            onChange={(e) => onChange('thinking_enabled', e.target.value === 'on')}
          >
            <option value="on">מופעל (temperature=1)</option>
            <option value="off">כבוי</option>
          </select>
        </div>

        <div className="config-item">
          <label className="config-item__label" htmlFor={budgetId}>תקציב חשיבה · tokens</label>
          <input
            id={budgetId}
            type="number"
            className="config-item__input"
            value={values.thinking_budget}
            onChange={(e) => onChange('thinking_budget', parseInt(e.target.value) || 2048)}
            min="1024" max="16000" step="512"
            disabled={!values.thinking_enabled}
          />
        </div>
      </div>
    </div>
  );
}
