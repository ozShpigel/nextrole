import { useState } from 'react';
import { discoveryApi } from '../utils/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export function CriteriaCard({ criteria, index, onEdit, onDelete, onRun }) {
  return (
    <Card
      className="group relative p-[1.4rem_1.5rem] transition-all flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300 hover:border-border hover:shadow-[0_8px_24px_rgba(0,0,0,0.05)] hover:-translate-y-px"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="absolute top-0 right-0 w-[3px] h-[40px] rounded-tr-lg opacity-60 transition-all group-hover:opacity-100 group-hover:h-[64px]" style={{ background: 'linear-gradient(180deg, var(--primary) 0%, transparent 100%)' }} />

      <div className="flex justify-between items-start gap-3 mb-[0.85rem]">
        <h3 className="font-serif text-[1.15rem] font-bold text-foreground tracking-[-0.005em] leading-[1.3] flex-1 min-w-0">{criteria.name}</h3>
        <div className="flex gap-[0.35rem] shrink-0">
          <Button variant="outline" size="sm" onClick={() => onEdit(criteria)}>Edit</Button>
          <Button variant="destructive" size="sm" onClick={() => onDelete(criteria.id)}>Delete</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-[0.35rem] mb-[0.85rem]">
        {criteria.job_titles.map((t) => <span key={t} className="py-[0.2rem] px-[0.6rem] bg-muted text-primary border border-border rounded-[6px] text-[0.78rem] font-medium tracking-[0.01em]">{t}</span>)}
      </div>

      <div className="flex flex-col gap-[0.35rem] py-[0.7rem] mb-[0.85rem] border-t border-dashed border-border border-b">
        {criteria.locations.length > 0 && (
          <div className="flex items-center justify-between gap-2 text-[0.8rem]">
            <span className="text-muted-foreground tracking-[0.05em] text-[0.7rem] uppercase font-medium">Location</span>
            <span className="text-foreground font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={criteria.locations.join(', ')}>
              {criteria.locations.join(' · ')}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-[0.8rem]">
          <span className="text-muted-foreground tracking-[0.05em] text-[0.7rem] uppercase font-medium">Sites</span>
          <span className="text-foreground font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{criteria.site_names.join(' · ')}</span>
        </div>
      </div>

      <div className="flex items-center gap-[0.6rem] mb-[0.85rem]">
        <span className="text-[0.7rem] text-muted-foreground tracking-[0.1em] uppercase font-medium">Threshold</span>
        <Progress value={criteria.min_score_to_save} className="flex-1 h-[5px]" />
        <span className="font-serif text-[0.9rem] font-bold text-foreground tabular-nums tracking-[-0.01em]">
          {criteria.min_score_to_save}<small className="text-[0.65rem] text-muted-foreground font-medium font-mono tracking-[0.1em] uppercase ml-[0.2rem]">/100</small>
        </span>
      </div>

      <Button className="w-full mt-auto" onClick={() => onRun(criteria.id)}>
        Run Search →
      </Button>
    </Card>
  );
}

export function CriteriaSection({ criteria, onEdit, onDelete, onRun, onNew }) {
  return (
    <section className="mb-[3.25rem] relative">
      <div className="flex items-baseline gap-[0.85rem] mb-[1.3rem] flex-wrap">
        <Badge variant="outline" className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] tabular-nums border-border bg-muted/50">01</Badge>
        <span className="font-serif text-[1.35rem] font-bold text-foreground tracking-[-0.005em]">Search Criteria</span>
      </div>

      {criteria.length === 0 ? (
        <Card className="border-[1.5px] border-dashed p-[2.75rem_1.5rem] text-center shadow-none">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted border border-border text-primary font-serif text-[1.5rem] font-bold mb-[0.85rem]">+</div>
          <div className="font-serif text-[1.05rem] font-semibold text-foreground mb-[0.3rem]">No search criteria</div>
          <div className="text-muted-foreground text-[0.85rem] leading-[1.6] mb-[1.1rem] max-w-[360px] mx-auto">
            Define your first criteria to start automatically scanning jobs from LinkedIn and Indeed.
          </div>
          <Button onClick={onNew}>
            + Create New Criteria
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {criteria.map((c, i) => (
            <CriteriaCard
              key={c.id}
              criteria={c}
              index={i}
              onEdit={onEdit}
              onDelete={onDelete}
              onRun={onRun}
            />
          ))}
        </div>
      )}
    </section>
  );
}

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

export function CriteriaForm({ initial, onSave, onCancel }) {
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

  return (
    <form className="mb-8 p-7 bg-card border border-border rounded-lg shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300" onSubmit={submit}>
      <h3 className="font-serif text-[1.2rem] font-bold text-foreground mb-5 tracking-[-0.005em]">{initial ? 'Edit Criteria' : 'New Search Criteria'}</h3>

      <div className="mb-4">
        <Label>Name</Label>
        <Input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Senior Backend .NET"' />
      </div>

      <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
        <div className="mb-4">
          <Label>Job Titles (one per line)</Label>
          <Textarea value={titlesText} onChange={(e) => setTitlesText(e.target.value)} placeholder={"Senior Backend Engineer\nPlatform Engineer\nStaff Engineer"} rows={3} />
          <SuggestionChips
            suggestions={TITLE_SUGGESTIONS}
            currentLines={titlesText}
            onAdd={(t) => addLine(setTitlesText, titlesText, t)}
          />
        </div>
        <div className="mb-4">
          <Label>Locations (one per line)</Label>
          <Textarea value={locationsText} onChange={(e) => setLocationsText(e.target.value)} placeholder={"Tel Aviv\nRemote"} rows={3} />
          <SuggestionChips
            suggestions={LOCATION_SUGGESTIONS}
            currentLines={locationsText}
            onAdd={(l) => addLine(setLocationsText, locationsText, l)}
          />
        </div>
      </div>

      <div className="mb-4">
        <Label>Sites</Label>
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
          <Label>Results per Title</Label>
          <Select value={String(resultsWanted)} onValueChange={(v) => setResultsWanted(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESULTS_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={String(value)}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mb-4">
          <Label>Hours Old</Label>
          <Select value={String(hoursOld)} onValueChange={(v) => setHoursOld(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {HOURS_OLD_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={String(value)}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mb-4">
          <Label>Country</Label>
          <Input type="text" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="mb-4">
          <Label>Remote</Label>
          <Select value={isRemote === null ? 'any' : String(isRemote)} onValueChange={(v) => setIsRemote(v === 'any' ? null : v === 'true')}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="true">Yes</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-4">
        <Label>Min Score to Save</Label>
        <Input type="number" className="max-w-[120px]" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} min={0} max={100} />
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
