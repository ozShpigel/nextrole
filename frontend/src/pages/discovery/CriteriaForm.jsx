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
  const [minScore, setMinScore] = useState(initial?.min_score_to_save || 70);
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

  const inputCls = "w-full py-[0.6rem] px-[0.85rem] bg-white border border-[rgba(120,100,70,0.12)] rounded-lg text-text-primary text-[0.88rem] font-sans transition-all focus:border-accent focus:ring-[3px] focus:ring-accent-glow focus:outline-none";

  return (
    <form className="mb-8 p-7 bg-warm border border-border rounded-lg shadow-md animate-card-in" onSubmit={submit}>
      <h3 className="font-serif text-[1.2rem] font-bold text-text-bright mb-5 tracking-[-0.005em]">{initial ? 'עריכת קריטריון' : 'קריטריון חיפוש חדש'}</h3>

      <div className="mb-4">
        <label className="block text-[0.72rem] text-text-dim mb-[0.4rem] uppercase tracking-[0.12em] font-medium">שם</label>
        <input type="text" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder='לדוגמה: "Senior Backend .NET"' />
      </div>

      <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
        <div className="mb-4">
          <label className="block text-[0.72rem] text-text-dim mb-[0.4rem] uppercase tracking-[0.12em] font-medium">כותרות משרה (שורה לכל כותרת)</label>
          <textarea className={`${inputCls} resize-y leading-[1.6]`} value={titlesText} onChange={(e) => setTitlesText(e.target.value)} placeholder="Senior Backend Engineer&#10;Platform Engineer&#10;Staff Engineer" rows={3} />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-text-dim mb-[0.4rem] uppercase tracking-[0.12em] font-medium">מיקומים (שורה לכל מיקום)</label>
          <textarea className={`${inputCls} resize-y leading-[1.6]`} value={locationsText} onChange={(e) => setLocationsText(e.target.value)} placeholder="Tel Aviv&#10;Remote" rows={3} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 max-[640px]:grid-cols-1">
        <div className="mb-4">
          <label className="block text-[0.72rem] text-text-dim mb-[0.4rem] uppercase tracking-[0.12em] font-medium">אתרים</label>
          <input type="text" className={inputCls} value={siteNames} onChange={(e) => setSiteNames(e.target.value)} placeholder="linkedin, indeed" />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-text-dim mb-[0.4rem] uppercase tracking-[0.12em] font-medium">מדינה</label>
          <input type="text" className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-text-dim mb-[0.4rem] uppercase tracking-[0.12em] font-medium">עבודה מרחוק</label>
          <select className={inputCls} value={isRemote === null ? '' : String(isRemote)} onChange={(e) => setIsRemote(e.target.value === '' ? null : e.target.value === 'true')}>
            <option value="">לא משנה</option>
            <option value="true">כן</option>
            <option value="false">לא</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 max-[640px]:grid-cols-1">
        <div className="mb-4">
          <label className="block text-[0.72rem] text-text-dim mb-[0.4rem] uppercase tracking-[0.12em] font-medium">תוצאות לכותרת</label>
          <input type="number" className={inputCls} value={resultsWanted} onChange={(e) => setResultsWanted(Number(e.target.value))} min={1} max={50} />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-text-dim mb-[0.4rem] uppercase tracking-[0.12em] font-medium">שעות אחרונות</label>
          <input type="number" className={inputCls} value={hoursOld} onChange={(e) => setHoursOld(Number(e.target.value))} min={1} max={720} />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-text-dim mb-[0.4rem] uppercase tracking-[0.12em] font-medium">סף ציון לשמירה</label>
          <input type="number" className={inputCls} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} min={0} max={100} />
        </div>
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
