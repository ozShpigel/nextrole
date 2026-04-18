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
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [configSaveResult, setConfigSaveResult] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await profileApi('/profile');
        const content = data?.content || '';
        setProfile(content);
        setOriginalProfile(content);
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
    load();
  }, []);

  const isProfileDirty = profile !== originalProfile;
  const isConfigDirty = JSON.stringify(config) !== JSON.stringify(originalConfig);

  async function handleSaveProfile() {
    setSaving(true);
    setSaveResult(null);
    try {
      const data = await profileApi('/profile', {
        method: 'PUT',
        body: JSON.stringify({ content: profile }),
      });
      setOriginalProfile(profile);
      setLastUpdated(data?.updated_at);
      setSaveResult({ type: 'success', message: 'הפרופיל נשמר בהצלחה' });
    } catch (e) {
      setSaveResult({ type: 'error', message: `שגיאה בשמירה: ${e.message}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveConfig() {
    setSavingConfig(true);
    setConfigSaveResult(null);
    try {
      const data = await profileApi('/profile', {
        method: 'PUT',
        body: JSON.stringify({ content: originalProfile, scoring_config: config }),
      });
      if (data?.scoring_config) {
        setConfig({ ...DEFAULT_CONFIG, ...data.scoring_config });
        setOriginalConfig({ ...DEFAULT_CONFIG, ...data.scoring_config });
      }
      setLastUpdated(data?.updated_at);
      setConfigSaveResult({ type: 'success', message: 'תצורת הניתוח נשמרה בהצלחה' });
    } catch (e) {
      setConfigSaveResult({ type: 'error', message: `שגיאה בשמירה: ${e.message}` });
    } finally {
      setSavingConfig(false);
    }
  }

  function handleResetProfile() {
    setProfile(originalProfile);
    setSaveResult(null);
  }

  function handleResetConfig() {
    setConfig(originalConfig);
    setConfigSaveResult(null);
  }

  function updateConfig(key, value) {
    setConfig(prev => ({ ...prev, [key]: value }));
    setConfigSaveResult(null);
  }

  if (loading) return <div className="settings-page"><p className="empty-state">טוען הגדרות...</p></div>;

  return (
    <div className="settings-page">
      <header className="settings-hero">
        <span className="settings-hero__eyebrow">Configuration · 2026</span>
        <h1 className="settings-hero__title">הגדרות</h1>
        <p className="settings-hero__sub">
          צפייה ועריכה של נתוני הקלט לניתוח Claude — הפרופיל המקצועי ופרמטרי המודל.
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
          onChange={(e) => { setProfile(e.target.value); setSaveResult(null); }}
          dir="auto"
          spellCheck={false}
        />
        <div className="settings-editor__footer">
          <span className="settings-editor__count">{profile.length.toLocaleString()} תווים</span>
          <div className="settings-editor__actions">
            {isProfileDirty && (
              <button className="btn btn-secondary btn-sm" onClick={handleResetProfile} disabled={saving}>
                ביטול שינויים
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={handleSaveProfile}
              disabled={saving || !isProfileDirty}
            >
              {saving ? 'שומר...' : 'שמור פרופיל'}
            </button>
          </div>
        </div>
        {saveResult && (
          <div className={`save-result ${saveResult.type}`}>{saveResult.message}</div>
        )}
      </section>

      {/* 02 — Scoring Config */}
      <section className="settings-section">
        <div className="settings-section__label">
          <span className="settings-section__num">02</span>
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
            <button className="btn btn-secondary btn-sm" onClick={handleResetConfig} disabled={savingConfig}>
              ביטול שינויים
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSaveConfig}
            disabled={savingConfig || !isConfigDirty}
          >
            {savingConfig ? 'שומר...' : 'שמור תצורה'}
          </button>
        </div>
        {configSaveResult && (
          <div className={`save-result ${configSaveResult.type}`}>{configSaveResult.message}</div>
        )}
      </section>

      {/* 03 — Scoring Structure */}
      <section className="settings-section">
        <div className="settings-section__label">
          <span className="settings-section__num">03</span>
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
