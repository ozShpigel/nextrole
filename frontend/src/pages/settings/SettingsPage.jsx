import { useState, useEffect } from 'react';
import { discoveryApi } from '../../utils/api';
import '../../styles/settings.css';

export default function SettingsPage() {
  const [profile, setProfile] = useState('');
  const [originalProfile, setOriginalProfile] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveResult, setSaveResult] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await discoveryApi('/profile');
        const content = data?.content || '';
        setProfile(content);
        setOriginalProfile(content);
        setLastUpdated(data?.updated_at);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const isDirty = profile !== originalProfile;

  async function handleSave() {
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

  function handleReset() {
    setProfile(originalProfile);
    setSaveResult(null);
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
              {isDirty && (
                <button className="btn btn-secondary btn-sm" onClick={handleReset} disabled={saving}>
                  ביטול שינויים
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || !isDirty}
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

      <section className="settings-section">
        <div className="settings-card">
          <h3>תצורת ניתוח</h3>
          <p className="settings-card__desc">הגדרות מודל Claude והפרמטרים לניתוח משרות (לקריאה בלבד).</p>
          <div className="config-grid">
            <ConfigItem label="מודל - התאמת משרות" value="claude-sonnet-4-20250514" />
            <ConfigItem label="מודל - גילוי משרות" value="claude-sonnet-4-20250514" />
            <ConfigItem label="טמפרטורה - התאמה" value="0.5" />
            <ConfigItem label="טמפרטורה - גילוי" value="0.3" />
            <ConfigItem label="Max Tokens - התאמה" value="4,096" />
            <ConfigItem label="Max Tokens - גילוי" value="1,024" />
          </div>
        </div>
      </section>

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

function ConfigItem({ label, value }) {
  return (
    <div className="config-item">
      <span className="config-item__label">{label}</span>
      <span className="config-item__value">{value}</span>
    </div>
  );
}
