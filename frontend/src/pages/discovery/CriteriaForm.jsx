import { useState } from 'react';
import { discoveryApi } from '../../utils/api';

export default function CriteriaForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [titlesText, setTitlesText] = useState((initial?.job_titles || []).join('\n'));
  const [locationsText, setLocationsText] = useState((initial?.locations || []).join('\n'));
  const [siteNames, setSiteNames] = useState((initial?.site_names || ['linkedin']).join(', '));
  const [resultsWanted, setResultsWanted] = useState(initial?.results_wanted || 15);
  const [hoursOld, setHoursOld] = useState(initial?.hours_old || 72);
  const [country, setCountry] = useState(initial?.country || 'Israel');
  const [isRemote, setIsRemote] = useState(initial?.is_remote ?? null);
  const [minScore, setMinScore] = useState(initial?.min_score_to_save || 55);
  const [valuesText, setValuesText] = useState((initial?.values || []).join('\n'));
  const [preferences, setPreferences] = useState(initial?.preferences || '');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || !titlesText.trim()) return;

    setSaving(true);
    const payload = {
      name: name.trim(),
      job_titles: titlesText.split('\n').map(s => s.trim()).filter(Boolean),
      locations: locationsText.split('\n').map(s => s.trim()).filter(Boolean),
      site_names: siteNames.split(',').map(s => s.trim()).filter(Boolean),
      results_wanted: resultsWanted,
      hours_old: hoursOld,
      country,
      is_remote: isRemote,
      min_score_to_save: minScore,
      values: valuesText.split('\n').map(s => s.trim()).filter(Boolean),
      preferences: preferences.trim(),
    };

    try {
      if (initial?.id) {
        await discoveryApi(`/criteria/${initial.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await discoveryApi('/criteria', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      onSave();
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="criteria-form card" onSubmit={submit}>
      <h3>{initial ? 'עריכת קריטריון' : 'קריטריון חיפוש חדש'}</h3>

      <div className="form-group">
        <label>שם</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder='לדוגמה: "Senior Backend .NET"' />
      </div>

      <div className="form-row-2">
        <div className="form-group">
          <label>כותרות משרה (שורה לכל כותרת)</label>
          <textarea value={titlesText} onChange={(e) => setTitlesText(e.target.value)} placeholder="Senior Backend Engineer&#10;Platform Engineer&#10;Staff Engineer" rows={3} />
        </div>
        <div className="form-group">
          <label>מיקומים (שורה לכל מיקום)</label>
          <textarea value={locationsText} onChange={(e) => setLocationsText(e.target.value)} placeholder="Tel Aviv&#10;Remote" rows={3} />
        </div>
      </div>

      <div className="form-row-3">
        <div className="form-group">
          <label>אתרים</label>
          <input type="text" value={siteNames} onChange={(e) => setSiteNames(e.target.value)} placeholder="linkedin, indeed" />
        </div>
        <div className="form-group">
          <label>מדינה</label>
          <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="form-group">
          <label>עבודה מרחוק</label>
          <select value={isRemote === null ? '' : String(isRemote)} onChange={(e) => setIsRemote(e.target.value === '' ? null : e.target.value === 'true')}>
            <option value="">לא משנה</option>
            <option value="true">כן</option>
            <option value="false">לא</option>
          </select>
        </div>
      </div>

      <div className="form-row-3">
        <div className="form-group">
          <label>תוצאות לכותרת</label>
          <input type="number" value={resultsWanted} onChange={(e) => setResultsWanted(Number(e.target.value))} min={1} max={50} />
        </div>
        <div className="form-group">
          <label>שעות אחרונות</label>
          <input type="number" value={hoursOld} onChange={(e) => setHoursOld(Number(e.target.value))} min={1} max={720} />
        </div>
        <div className="form-group">
          <label>סף ציון לשמירה</label>
          <input type="number" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} min={0} max={100} />
        </div>
      </div>

      <div className="form-group">
        <label>ערכים (שורה לכל ערך)</label>
        <textarea value={valuesText} onChange={(e) => setValuesText(e.target.value)} placeholder="ownership&#10;sustainable pace&#10;async culture" rows={3} />
      </div>

      <div className="form-group">
        <label>העדפות נוספות (טקסט חופשי)</label>
        <textarea value={preferences} onChange={(e) => setPreferences(e.target.value)} placeholder="מעדיף חברות בגודל בינוני, לא סטארטאפ מאוד מוקדם..." rows={2} />
      </div>

      <div className="btn-group">
        <button className="btn btn-primary" type="submit" disabled={saving || !name.trim() || !titlesText.trim()}>
          {saving ? 'שומר...' : (initial ? 'עדכן' : 'צור')}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel}>ביטול</button>
      </div>
    </form>
  );
}
