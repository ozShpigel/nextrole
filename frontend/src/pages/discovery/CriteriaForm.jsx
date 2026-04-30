import { useState } from 'react';
import { discoveryApi } from '../../utils/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const TITLE_SUGGESTIONS = [
  'Software Engineer', 'Senior Software Engineer', 'Full Stack Developer',
  'Backend Developer', 'Frontend Developer', 'DevOps Engineer',
  'DevOps Automation Engineer', 'Platform Engineer', 'Cloud Engineer',
  'Internal Tools Engineer', 'AI Engineer', 'ML Engineer',
  'Data Engineer', 'Data Scientist', 'Product Manager',
  'QA Engineer', 'Mobile Developer', 'Solutions Architect',
];

const LOCATION_SUGGESTIONS = [
  'Central Israel', 'Tel Aviv', 'Ramat Gan', 'Herzliya', 'Petah Tikva',
  'North Israel', 'Haifa', 'South Israel', 'Beer Sheva',
  'Jerusalem', 'Remote', 'New York', 'San Francisco', 'London',
];

const AVAILABLE_SITES = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'indeed', label: 'Indeed' },
  { value: 'glassdoor', label: 'Glassdoor' },
  { value: 'zip_recruiter', label: 'ZipRecruiter' },
  { value: 'google', label: 'Google' },
];

const HOURS_OLD_OPTIONS = [
  { value: 24, label: '24 hours' },
  { value: 48, label: '48 hours' },
  { value: 72, label: '3 days' },
  { value: 168, label: '1 week' },
  { value: 336, label: '2 weeks' },
  { value: 720, label: '30 days' },
];

const RESULTS_OPTIONS = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 15, label: '15' },
  { value: 25, label: '25' },
  { value: 50, label: '50' },
];

function SuggestionChips({ suggestions, currentLines, onAdd }) {
  const existing = new Set(currentLines.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean));
  const available = suggestions.filter(s => !existing.has(s.toLowerCase()));
  if (available.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-[0.3rem] mt-[0.4rem]">
      {available.map(s => (
        <button
          key={s}
          type="button"
          className="py-[0.15rem] px-[0.5rem] bg-muted hover:bg-primary/10 border border-border hover:border-primary/30 rounded-md text-[0.72rem] text-muted-foreground hover:text-primary transition-all cursor-pointer"
          onClick={() => onAdd(s)}
        >
          + {s}
        </button>
      ))}
    </div>
  );
}

export default function CriteriaForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [titlesText, setTitlesText] = useState((initial?.job_titles || []).join('\n'));
  const [locationsText, setLocationsText] = useState((initial?.locations || []).join('\n'));
  const [selectedSites, setSelectedSites] = useState(initial?.site_names || ['linkedin']);
  const [resultsWanted, setResultsWanted] = useState(initial?.results_wanted || 15);
  const [hoursOld, setHoursOld] = useState(initial?.hours_old || 72);
  const [country, setCountry] = useState(initial?.country || 'Israel');
  const [isRemote, setIsRemote] = useState(initial?.is_remote ?? null);
  const [minScore, setMinScore] = useState(initial?.min_score_to_save || 70);
  const [saving, setSaving] = useState(false);

  function addLine(setter, current, value) {
    const trimmed = current.trim();
    setter(trimmed ? trimmed + '\n' + value : value);
  }

  function toggleSite(site) {
    setSelectedSites(prev =>
      prev.includes(site) ? prev.filter(s => s !== site) : [...prev, site]
    );
  }

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || !titlesText.trim()) return;

    setSaving(true);
    const payload = {
      name: name.trim(),
      job_titles: titlesText.split('\n').map(s => s.trim()).filter(Boolean),
      locations: locationsText.split('\n').map(s => s.trim()).filter(Boolean),
      site_names: selectedSites,
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
  const labelCls = "block text-[0.72rem] text-muted-foreground mb-[0.4rem] uppercase tracking-[0.12em] font-medium";

  return (
    <form className="mb-8 p-7 bg-card border border-border rounded-lg shadow-md animate-card-in" onSubmit={submit}>
      <h3 className="font-serif text-[1.2rem] font-bold text-foreground mb-5 tracking-[-0.005em]">{initial ? 'Edit Criteria' : 'New Search Criteria'}</h3>

      <div className="mb-4">
        <label className={labelCls}>Name</label>
        <input type="text" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Senior Backend .NET"' />
      </div>

      <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
        <div className="mb-4">
          <label className={labelCls}>Job Titles (one per line)</label>
          <textarea className={`${inputCls} resize-y leading-[1.6]`} value={titlesText} onChange={(e) => setTitlesText(e.target.value)} placeholder="Senior Backend Engineer&#10;Platform Engineer&#10;Staff Engineer" rows={3} />
          <SuggestionChips
            suggestions={TITLE_SUGGESTIONS}
            currentLines={titlesText}
            onAdd={(t) => addLine(setTitlesText, titlesText, t)}
          />
        </div>
        <div className="mb-4">
          <label className={labelCls}>Locations (one per line)</label>
          <textarea className={`${inputCls} resize-y leading-[1.6]`} value={locationsText} onChange={(e) => setLocationsText(e.target.value)} placeholder="Tel Aviv&#10;Remote" rows={3} />
          <SuggestionChips
            suggestions={LOCATION_SUGGESTIONS}
            currentLines={locationsText}
            onAdd={(l) => addLine(setLocationsText, locationsText, l)}
          />
        </div>
      </div>

      <div className="mb-4">
        <label className={labelCls}>Sites</label>
        <div className="flex flex-wrap gap-[0.4rem]">
          {AVAILABLE_SITES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`py-[0.4rem] px-[0.75rem] rounded-lg text-[0.82rem] font-medium border transition-all cursor-pointer ${
                selectedSites.includes(value)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-input hover:border-primary/30 hover:text-foreground'
              }`}
              onClick={() => toggleSite(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {selectedSites.length === 0 && (
          <p className="text-[0.72rem] text-destructive mt-[0.3rem]">Select at least one site</p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4 max-[640px]:grid-cols-2">
        <div className="mb-4">
          <label className={labelCls}>Results per Title</label>
          <select className={inputCls} value={resultsWanted} onChange={(e) => setResultsWanted(Number(e.target.value))}>
            {RESULTS_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="mb-4">
          <label className={labelCls}>Hours Old</label>
          <select className={inputCls} value={hoursOld} onChange={(e) => setHoursOld(Number(e.target.value))}>
            {HOURS_OLD_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="mb-4">
          <label className={labelCls}>Country</label>
          <input type="text" className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="mb-4">
          <label className={labelCls}>Remote</label>
          <select className={inputCls} value={isRemote === null ? '' : String(isRemote)} onChange={(e) => setIsRemote(e.target.value === '' ? null : e.target.value === 'true')}>
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
      </div>

      <div className="mb-4">
        <label className={labelCls}>Min Score to Save</label>
        <input type="number" className={inputCls + " max-w-[120px]"} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} min={0} max={100} />
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !name.trim() || !titlesText.trim() || selectedSites.length === 0}>
          {saving ? 'Saving...' : (initial ? 'Update' : 'Create')}
        </Button>
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
