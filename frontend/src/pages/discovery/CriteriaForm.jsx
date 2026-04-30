import { useState } from 'react';
import { discoveryApi } from '../../utils/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
      alert('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full py-[0.6rem] px-[0.85rem] bg-background border border-input rounded-lg text-foreground text-[0.88rem] font-sans transition-all focus:border-ring focus:ring-[3px] focus:ring-ring/20 focus:outline-none";

  return (
    <form className="mb-8 p-7 bg-card border border-border rounded-lg shadow-md animate-card-in" onSubmit={submit}>
      <h3 className="font-serif text-[1.2rem] font-bold text-foreground mb-5 tracking-[-0.005em]">{initial ? 'Edit Criteria' : 'New Search Criteria'}</h3>

      <div className="mb-4">
        <label className="block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium">Name</label>
        <input type="text" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Senior Backend .NET"' />
      </div>

      <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
        <div className="mb-4">
          <label className="block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium">Job Titles (one per line)</label>
          <textarea className={`${inputCls} resize-y leading-[1.6]`} value={titlesText} onChange={(e) => setTitlesText(e.target.value)} placeholder="Senior Backend Engineer&#10;Platform Engineer&#10;Staff Engineer" rows={3} />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium">Locations (one per line)</label>
          <textarea className={`${inputCls} resize-y leading-[1.6]`} value={locationsText} onChange={(e) => setLocationsText(e.target.value)} placeholder="Tel Aviv&#10;Remote" rows={3} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 max-[640px]:grid-cols-1">
        <div className="mb-4">
          <label className="block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium">Sites</label>
          <input type="text" className={inputCls} value={siteNames} onChange={(e) => setSiteNames(e.target.value)} placeholder="linkedin, indeed" />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium">Country</label>
          <input type="text" className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium">Remote</label>
          <select className={inputCls} value={isRemote === null ? '' : String(isRemote)} onChange={(e) => setIsRemote(e.target.value === '' ? null : e.target.value === 'true')}>
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 max-[640px]:grid-cols-1">
        <div className="mb-4">
          <label className="block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium">Results per Title</label>
          <input type="number" className={inputCls} value={resultsWanted} onChange={(e) => setResultsWanted(Number(e.target.value))} min={1} max={50} />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium">Hours Old</label>
          <input type="number" className={inputCls} value={hoursOld} onChange={(e) => setHoursOld(Number(e.target.value))} min={1} max={720} />
        </div>
        <div className="mb-4">
          <label className="block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium">Min Score to Save</label>
          <input type="number" className={inputCls} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} min={0} max={100} />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !name.trim() || !titlesText.trim()}>
          {saving ? 'Saving...' : (initial ? 'Update' : 'Create')}
        </Button>
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
