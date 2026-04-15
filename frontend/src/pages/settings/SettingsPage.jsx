import { useState, useEffect } from 'react';
import { discoveryApi } from '../../utils/api';
import '../../styles/settings.css';

const MODEL_OPTIONS = [
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
];

const DEFAULT_CONFIG = {
  model: 'claude-opus-4-20250514',
  temperature_match: 0.5,
  temperature_discovery: 0.3,
  max_tokens_match: 4096,
  max_tokens_discovery: 1024,
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
        const data = await discoveryApi('/profile');
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
      const data = await discoveryApi('/profile', {
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
      const data = await discoveryApi('/profile', {
        method: 'PUT',
        body: JSON.stringify({ scoring_config: config }),
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
      <header className="settings-header">
        <div>
          <h1>הגדרות</h1>
          <p className="subtitle">צפייה ועריכה של נתוני הקלט לניתוח Claude</p>
        </div>
      </header>

      {error && <div className="settings-error">{error}</div>}

      {/* Profile Editor */}
      <section className="settings-section">
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>פרופיל מקצועי</h3>
            <span className="settings-card__badge">
              {lastUpdated
                ? `עודכן: ${new Date(lastUpdated).toLocaleDateString('he-IL')}`
                : 'מקור: קובץ מקומי'}
            </span>
          </div>
          <p className="settings-card__desc">
            הפרופיל המקצועי שנשלח ל-Claude לצורך ניתוח והתאמת משרות. ניתן לערוך ולשמור — השינויים ייכנסו לתוקף מיידית.
          </p>
          <textarea
            className="settings-editor"
            value={profile}
            onChange={(e) => { setProfile(e.target.value); setSaveResult(null); }}
            dir="auto"
            spellCheck={false}
          />
          <div className="settings-editor__footer">
            <span className="settings-editor__count">{profile.length} תווים</span>
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
        </div>
      </section>

      {/* Scoring Config */}
      <section className="settings-section">
        <div className="settings-card">
          <h3>תצורת ניתוח</h3>
          <p className="settings-card__desc">הגדרות מודל Claude והפרמטרים לניתוח משרות.</p>
          <div className="config-grid">
            <div className="config-item config-item--editable">
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
            <div className="config-item config-item--editable">
              <label className="config-item__label" htmlFor="cfg-temp-match">טמפרטורה - התאמה</label>
              <input
                id="cfg-temp-match"
                type="number"
                className="config-item__input"
                value={config.temperature_match}
                onChange={(e) => updateConfig('temperature_match', parseFloat(e.target.value) || 0)}
                min="0" max="1" step="0.1"
              />
            </div>
            <div className="config-item config-item--editable">
              <label className="config-item__label" htmlFor="cfg-temp-disc">טמפרטורה - גילוי</label>
              <input
                id="cfg-temp-disc"
                type="number"
                className="config-item__input"
                value={config.temperature_discovery}
                onChange={(e) => updateConfig('temperature_discovery', parseFloat(e.target.value) || 0)}
                min="0" max="1" step="0.1"
              />
            </div>
            <div className="config-item config-item--editable">
              <label className="config-item__label" htmlFor="cfg-tokens-match">Max Tokens - התאמה</label>
              <input
                id="cfg-tokens-match"
                type="number"
                className="config-item__input"
                value={config.max_tokens_match}
                onChange={(e) => updateConfig('max_tokens_match', parseInt(e.target.value) || 1024)}
                min="256" max="8192" step="256"
              />
            </div>
            <div className="config-item config-item--editable">
              <label className="config-item__label" htmlFor="cfg-tokens-disc">Max Tokens - גילוי</label>
              <input
                id="cfg-tokens-disc"
                type="number"
                className="config-item__input"
                value={config.max_tokens_discovery}
                onChange={(e) => updateConfig('max_tokens_discovery', parseInt(e.target.value) || 1024)}
                min="256" max="8192" step="256"
              />
            </div>
          </div>
          <div className="settings-editor__footer" style={{ marginTop: '1rem' }}>
            <span className="settings-editor__count" />
            <div className="settings-editor__actions">
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
          </div>
          {configSaveResult && (
            <div className={`save-result ${configSaveResult.type}`}>{configSaveResult.message}</div>
          )}
        </div>
      </section>

      {/* Scoring Overview */}
      <section className="settings-section">
        <div className="settings-card">
          <h3>מבנה ניתוח</h3>
          <p className="settings-card__desc">שלבי הניתוח ומבנה הציון.</p>
          <div className="scoring-overview">
            <div className="scoring-dimension">
              <div className="scoring-dimension__header">
                <span className="scoring-dimension__name">התאמה טכנית</span>
                <span className="scoring-dimension__points">35 נקודות</span>
              </div>
              <div className="scoring-dimension__details">Core Stack (0-20) + System Design (0-15)</div>
            </div>
            <div className="scoring-dimension">
              <div className="scoring-dimension__header">
                <span className="scoring-dimension__name">התאמה תרבותית</span>
                <span className="scoring-dimension__points">35 נקודות</span>
              </div>
              <div className="scoring-dimension__details">Work Style (0-15) + Communication (0-10) + Ownership (0-10)</div>
            </div>
            <div className="scoring-dimension">
              <div className="scoring-dimension__header">
                <span className="scoring-dimension__name">מאפייני התפקיד</span>
                <span className="scoring-dimension__points">30 נקודות</span>
              </div>
              <div className="scoring-dimension__details">Problem Domain (0-15) + Pace (0-10) + Growth (0-5)</div>
            </div>
          </div>
          <div className="verdict-legend">
            <span className="verdict-item verdict-strong-yes">STRONG_YES 80-100</span>
            <span className="verdict-item verdict-yes">YES 60-79</span>
            <span className="verdict-item verdict-maybe">MAYBE 40-59</span>
            <span className="verdict-item verdict-no">NO 20-39</span>
            <span className="verdict-item verdict-strong-no">STRONG_NO 0-19</span>
          </div>
        </div>
      </section>
    </div>
  );
}
