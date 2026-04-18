import { useState, useEffect } from 'react';
import { profileApi } from '../../utils/api';
import '../../styles/settings.css';

const MODEL_OPTIONS = [
  'claude-sonnet-4-6',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
];

const DEFAULT_CONFIG = {
  model: 'claude-sonnet-4-6',
  temperature: 0.5,
  max_tokens: 4096,
  thinking_enabled: false,
  thinking_budget: 2048,
  min_score_to_save: 70,
};

export default function SettingsPage() {
  const [profile, setProfile] = useState('');
  const [originalProfile, setOriginalProfile] = useState('');
  const [analystPrompt, setAnalystPrompt] = useState('');
  const [originalAnalystPrompt, setOriginalAnalystPrompt] = useState('');
  const [evaluatorPrompt, setEvaluatorPrompt] = useState('');
  const [originalEvaluatorPrompt, setOriginalEvaluatorPrompt] = useState('');
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

      const evaluator = data?.evaluator_prompt || '';
      setEvaluatorPrompt(evaluator);
      setOriginalEvaluatorPrompt(evaluator);

      setLastUpdated(data?.updated_at);
      if (data?.scoring_config) {
        setConfig({ ...DEFAULT_CONFIG, ...data.scoring_config });
        setOriginalConfig({ ...DEFAULT_CONFIG, ...data.scoring_config });
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
    },
    'פרומפט ההערכה',
  );

  const saveConfig = () => saveField(
    { scoring_config: config },
    setSavingConfig, setConfigResult,
    (data) => {
      if (data?.scoring_config) {
        setConfig({ ...DEFAULT_CONFIG, ...data.scoring_config });
        setOriginalConfig({ ...DEFAULT_CONFIG, ...data.scoring_config });
      }
    },
    'תצורת הניתוח',
  );

  async function resetAnalystToSeed() {
    if (!confirm('לאפס את פרומפט האנליסט לברירת המחדל? פעולה זו תמחק את הטקסט המותאם אישית.')) return;
    await saveField(
      { analyst_prompt: '' },
      setSavingAnalyst, setAnalystResult,
      (data) => {
        const v = data?.analyst_prompt || '';
        setAnalystPrompt(v);
        setOriginalAnalystPrompt(v);
      },
      'פרומפט האנליסט אופס',
    );
  }

  async function resetEvaluatorToSeed() {
    if (!confirm('לאפס את פרומפט ההערכה לברירת המחדל? פעולה זו תמחק את הטקסט המותאם אישית.')) return;
    await saveField(
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

  function updateConfig(key, value) {
    setConfig(prev => ({ ...prev, [key]: value }));
    setConfigResult(null);
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
          <span className="settings-editor__count">{profile.length.toLocaleString()} תווים</span>
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
      <section className="settings-section">
        <div className="settings-section__label">
          <span className="settings-section__num">02</span>
          <span className="settings-section__name">פרומפט אנליסט</span>
          <span className="settings-section__badge">שלב 1 · פרסינג</span>
        </div>
        <p className="settings-section__desc">
          ההנחיה ל-Claude בשלב פרסינג המשרה — מחלצת כותרת, טכנולוגיות, רמת ניסיון ואותות תרבותיים ומחזירה JSON מובנה. ניקוי השדה יחזיר לברירת המחדל מהקובץ המצורף לשירות.
        </p>
        <textarea
          className="settings-editor"
          value={analystPrompt}
          onChange={(e) => { setAnalystPrompt(e.target.value); setAnalystResult(null); }}
          dir="auto"
          spellCheck={false}
          style={{ minHeight: '400px' }}
        />
        <div className="settings-editor__footer">
          <span className="settings-editor__count">{analystPrompt.length.toLocaleString()} תווים</span>
          <div className="settings-editor__actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={resetAnalystToSeed}
              disabled={savingAnalyst}
              title="אפס לברירת המחדל (הקובץ המצורף לשירות)"
            >
              אפס לברירת מחדל
            </button>
            {isAnalystDirty && (
              <button className="btn btn-secondary btn-sm" onClick={() => setAnalystPrompt(originalAnalystPrompt)} disabled={savingAnalyst}>
                ביטול שינויים
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={saveAnalyst}
              disabled={savingAnalyst || !isAnalystDirty}
            >
              {savingAnalyst ? 'שומר...' : 'שמור פרומפט'}
            </button>
          </div>
        </div>
        {analystResult && (
          <div className={`save-result ${analystResult.type}`}>{analystResult.message}</div>
        )}
      </section>

      {/* 03 — Evaluator Prompt */}
      <section className="settings-section">
        <div className="settings-section__label">
          <span className="settings-section__num">03</span>
          <span className="settings-section__name">פרומפט הערכה</span>
          <span className="settings-section__badge">שלב 2 · דירוג</span>
        </div>
        <p className="settings-section__desc">
          ההנחיה ל-Claude בשלב ההערכה — מדרג התאמה במאה נקודות לפי טכנולוגיה, תרבות ומאפייני תפקיד. שני הפלייסהולדרים <code>{'{{USER_PROFILE}}'}</code> ו-<code>{'{{PARSED_JOB}}'}</code> מוחלפים בזמן ריצה ואסור למחוק אותם. ניקוי השדה יחזיר לברירת המחדל.
        </p>
        <textarea
          className="settings-editor"
          value={evaluatorPrompt}
          onChange={(e) => { setEvaluatorPrompt(e.target.value); setEvaluatorResult(null); }}
          dir="auto"
          spellCheck={false}
          style={{ minHeight: '500px' }}
        />
        <div className="settings-editor__footer">
          <span className="settings-editor__count">{evaluatorPrompt.length.toLocaleString()} תווים</span>
          <div className="settings-editor__actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={resetEvaluatorToSeed}
              disabled={savingEvaluator}
              title="אפס לברירת המחדל (הקובץ המצורף לשירות)"
            >
              אפס לברירת מחדל
            </button>
            {isEvaluatorDirty && (
              <button className="btn btn-secondary btn-sm" onClick={() => setEvaluatorPrompt(originalEvaluatorPrompt)} disabled={savingEvaluator}>
                ביטול שינויים
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={saveEvaluator}
              disabled={savingEvaluator || !isEvaluatorDirty}
            >
              {savingEvaluator ? 'שומר...' : 'שמור פרומפט'}
            </button>
          </div>
        </div>
        {evaluatorResult && (
          <div className={`save-result ${evaluatorResult.type}`}>{evaluatorResult.message}</div>
        )}
      </section>

      {/* 04 — Scoring Config */}
      <section className="settings-section">
        <div className="settings-section__label">
          <span className="settings-section__num">04</span>
          <span className="settings-section__name">תצורת ניתוח</span>
        </div>
        <p className="settings-section__desc">
          הגדרות מודל Claude ופרמטרי הניתוח. חשיבה מורחבת מאלצת טמפרטורה של 1.
        </p>
        <div className="config-grid">
          <div className="config-item">
            <label className="config-item__label" htmlFor="cfg-model">מודל Claude</label>
            <select
              id="cfg-model"
              className="config-item__select"
              value={config.model}
              onChange={(e) => updateConfig('model', e.target.value)}
            >
              {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="config-item">
            <label className="config-item__label" htmlFor="cfg-temp">טמפרטורה</label>
            <input
              id="cfg-temp"
              type="number"
              className="config-item__input"
              value={config.temperature}
              onChange={(e) => updateConfig('temperature', parseFloat(e.target.value) || 0)}
              min="0" max="1" step="0.1"
              disabled={config.thinking_enabled}
            />
          </div>
          <div className="config-item">
            <label className="config-item__label" htmlFor="cfg-tokens">Max Tokens</label>
            <input
              id="cfg-tokens"
              type="number"
              className="config-item__input"
              value={config.max_tokens}
              onChange={(e) => updateConfig('max_tokens', parseInt(e.target.value) || 1024)}
              min="512" max="16384" step="512"
            />
          </div>
          <div className="config-item">
            <label className="config-item__label" htmlFor="cfg-thinking">חשיבה מורחבת</label>
            <select
              id="cfg-thinking"
              className="config-item__select"
              value={config.thinking_enabled ? 'on' : 'off'}
              onChange={(e) => updateConfig('thinking_enabled', e.target.value === 'on')}
            >
              <option value="on">מופעל (temperature=1)</option>
              <option value="off">כבוי</option>
            </select>
          </div>
          <div className="config-item">
            <label className="config-item__label" htmlFor="cfg-thinking-budget">תקציב חשיבה · tokens</label>
            <input
              id="cfg-thinking-budget"
              type="number"
              className="config-item__input"
              value={config.thinking_budget}
              onChange={(e) => updateConfig('thinking_budget', parseInt(e.target.value) || 2048)}
              min="1024" max="16000" step="512"
              disabled={!config.thinking_enabled}
            />
          </div>
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
