import { useState } from 'react';
import { useSaveCriteria } from '../lib/mutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface Criteria {
  id: string;
  name: string;
  job_titles: string[];
  locations: string[];
  site_names: string[];
  results_wanted: number;
  hours_old: number;
  country: string;
  is_remote: boolean | null;
  min_score_to_save: number;
}

interface CriteriaCardProps {
  criteria: Criteria;
  index: number;
  onEdit: (criteria: Criteria) => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
}

export function CriteriaCard({ criteria, index, onEdit, onDelete, onRun }: CriteriaCardProps) {
  const num = String(index + 1).padStart(2, '0');
  return (
    <div
      className="ed-rise group relative flex flex-col border-t border-[var(--ed-rule-strong)] pt-4 pb-1"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex justify-between items-start gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="ed-display text-[1.4rem] leading-none pt-[2px] tabular-nums text-[var(--ed-ink-faint)]">{num}</span>
          <h3 className="ed-display font-semibold text-[1.3rem] tracking-[-0.015em] leading-[1.15] text-[var(--ed-ink)] transition-colors group-hover:text-[var(--ed-accent-deep)]">{criteria.name}</h3>
        </div>
        <div className="flex gap-[0.35rem] shrink-0">
          <Button variant="ghost" size="sm" onClick={() => onEdit(criteria)} className="rounded-none h-7 px-2 text-[0.7rem] uppercase tracking-[0.06em] text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel)] hover:text-[var(--ed-ink)]">Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => onDelete(criteria.id)} className="rounded-none h-7 px-2 text-[0.7rem] uppercase tracking-[0.06em] text-[var(--ed-no)] hover:bg-[var(--ed-no)]/10">Delete</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-[0.35rem] mb-[0.85rem] pl-[calc(1.4rem+0.75rem)] max-[480px]:pl-0">
        {criteria.job_titles.map((t) => <span key={t} className="py-[0.15rem] px-[0.55rem] border border-[var(--ed-rule)] text-[var(--ed-ink-soft)] text-[0.74rem] font-medium tracking-[0.01em]">{t}</span>)}
      </div>

      <div className="flex flex-col gap-[0.35rem] py-[0.7rem] mb-[0.85rem] border-y border-dashed border-[var(--ed-rule)]">
        {criteria.locations.length > 0 && (
          <div className="flex items-center justify-between gap-2 text-[0.8rem]">
            <span className="text-[var(--ed-ink-faint)] tracking-[0.08em] text-[0.64rem] uppercase font-semibold">Location</span>
            <span className="text-[var(--ed-ink)] font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={criteria.locations.join(', ')}>
              {criteria.locations.join(' · ')}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-[0.8rem]">
          <span className="text-[var(--ed-ink-faint)] tracking-[0.08em] text-[0.64rem] uppercase font-semibold">Sites</span>
          <span className="text-[var(--ed-ink)] font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{criteria.site_names.join(' · ')}</span>
        </div>
      </div>

      <div className="flex items-center gap-[0.6rem] mb-[1.1rem]">
        <span className="text-[0.64rem] text-[var(--ed-ink-faint)] tracking-[0.1em] uppercase font-semibold shrink-0">Threshold</span>
        <span className="relative flex-1 h-[3px] bg-[var(--ed-rule)] overflow-hidden">
          <span className="ed-fill bg-[var(--ed-ink)]" style={{ ['--p' as string]: criteria.min_score_to_save / 100 }} />
        </span>
        <span className="ed-display font-semibold text-[0.95rem] text-[var(--ed-ink)] tabular-nums shrink-0">
          {criteria.min_score_to_save}<small className="text-[0.6rem] text-[var(--ed-ink-faint)] font-medium tracking-[0.06em] ml-[0.15rem]">/100</small>
        </span>
      </div>

      <button
        type="button"
        onClick={() => onRun(criteria.id)}
        className="mt-auto w-full border border-[var(--ed-ink)] bg-transparent py-[0.6rem] text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-ink)] transition-all hover:bg-[var(--ed-ink)] hover:text-[var(--ed-paper)]"
      >
        Run Search →
      </button>
    </div>
  );
}

interface CriteriaSectionProps {
  criteria: Criteria[];
  onEdit: (criteria: Criteria) => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
  onNew: () => void;
}

export function CriteriaSection({ criteria, onEdit, onDelete, onRun, onNew }: CriteriaSectionProps) {
  return (
    <section className="mb-[3.25rem] relative">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="ed-display italic font-semibold text-[1.5rem] tracking-[-0.01em] text-[var(--ed-ink)]">Search Criteria</span>
        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">Section 01</span>
      </div>
      <div className="border-t border-[var(--ed-rule-strong)] mb-7" />

      {criteria.length === 0 ? (
        <div className="border border-dashed border-[var(--ed-rule)] p-[2.75rem_1.5rem] text-center">
          <div className="ed-display text-[2rem] font-black text-[var(--ed-accent)] mb-2">+</div>
          <div className="ed-display text-[1.15rem] font-semibold text-[var(--ed-ink)] mb-[0.3rem]">No search criteria</div>
          <div className="text-[var(--ed-ink-soft)] text-[0.85rem] leading-[1.6] mb-[1.1rem] max-w-[360px] mx-auto">
            Define your first criteria to start automatically scanning jobs from LinkedIn and Indeed.
          </div>
          <Button onClick={onNew} className="rounded-none bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)] uppercase text-[0.7rem] font-semibold tracking-[0.08em]">
            + Create New Criteria
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-9 gap-y-3 md:grid-cols-2">
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
  'DevOps Automation Engineer', 'Platform Engineer', 'Platform Developer',
  'Cloud Engineer', 'Internal Tools Engineer', 'DevEx',
  'Senior .NET Backend Engineer (Infrastructure-Oriented)', 'SRE',
  'AI Engineer', 'ML Engineer', 'AI Platform', 'AI DevOps Engineer',
  'AI Infrastructure', 'AI Engineering',
  'Data Engineer', 'Data Scientist', 'Product Manager',
  'QA Engineer', 'Mobile Developer', 'Solutions Architect',
];

const LOCATION_SUGGESTIONS = [
  'Central Israel', 'Tel Aviv', 'Ramat Gan', 'Herzliya', 'Petah Tikva',
  'Hasharon', 'North Israel', 'Haifa', 'South Israel', 'Beer Sheva',
  'Jerusalem', 'Remote', 'New York', 'San Francisco', 'London',
];

const AVAILABLE_SITES = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'indeed', label: 'Indeed' },
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

interface SuggestionChipsProps {
  suggestions: string[];
  currentLines: string;
  onAdd: (value: string) => void;
}

function SuggestionChips({ suggestions, currentLines, onAdd }: SuggestionChipsProps) {
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

interface CriteriaFormProps {
  initial?: Criteria | null;
  onSave: () => void;
  onCancel: () => void;
}

export function CriteriaForm({ initial, onSave, onCancel }: CriteriaFormProps) {
  const [name, setName] = useState(initial?.name || '');
  const [titlesText, setTitlesText] = useState((initial?.job_titles || []).join('\n'));
  const [locationsText, setLocationsText] = useState((initial?.locations || []).join('\n'));
  const [selectedSites, setSelectedSites] = useState<string[]>(initial?.site_names || ['linkedin']);
  const [resultsWanted, setResultsWanted] = useState(initial?.results_wanted || 15);
  const [hoursOld, setHoursOld] = useState(initial?.hours_old || 72);
  const [country, setCountry] = useState(initial?.country || 'Israel');
  const [isRemote, setIsRemote] = useState<boolean | null>(initial?.is_remote ?? null);
  const [minScore, setMinScore] = useState(initial?.min_score_to_save || 70);
  const saveCriteria = useSaveCriteria();

  function addLine(setter: React.Dispatch<React.SetStateAction<string>>, current: string, value: string) {
    const trimmed = current.trim();
    setter(trimmed ? trimmed + '\n' + value : value);
  }

  function toggleSite(site: string) {
    setSelectedSites(prev =>
      prev.includes(site) ? prev.filter(s => s !== site) : [...prev, site]
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !titlesText.trim()) return;

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

    saveCriteria.mutate(
      { id: initial?.id, payload },
      {
        onSuccess: () => onSave(),
        onError: (e) => alert('Error: ' + e.message),
      },
    );
  }

  return (
    <form className="mb-8 p-7 bg-card border border-border rounded-lg shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300" onSubmit={submit}>
      <h3 className="font-serif text-[1.2rem] font-bold text-foreground mb-5 tracking-[-0.005em]">{initial ? 'Edit Criteria' : 'New Search Criteria'}</h3>

      <div className="mb-4">
        <Label>Name</Label>
        <Input type="text" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder='e.g. "Senior Backend .NET"' />
      </div>

      <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
        <div className="mb-4">
          <Label>Job Titles (one per line)</Label>
          <Textarea value={titlesText} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTitlesText(e.target.value)} placeholder={"Senior Backend Engineer\nPlatform Engineer\nStaff Engineer"} rows={3} />
          <SuggestionChips
            suggestions={TITLE_SUGGESTIONS}
            currentLines={titlesText}
            onAdd={(t) => addLine(setTitlesText, titlesText, t)}
          />
        </div>
        <div className="mb-4">
          <Label>Locations (one per line)</Label>
          <Textarea value={locationsText} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setLocationsText(e.target.value)} placeholder={"Tel Aviv\nRemote"} rows={3} />
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
          <Select value={String(resultsWanted)} onValueChange={(v: string) => setResultsWanted(Number(v))}>
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
          <Select value={String(hoursOld)} onValueChange={(v: string) => setHoursOld(Number(v))}>
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
          <Input type="text" value={country} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCountry(e.target.value)} />
        </div>
        <div className="mb-4">
          <Label>Remote</Label>
          <Select value={isRemote === null ? 'any' : String(isRemote)} onValueChange={(v: string) => setIsRemote(v === 'any' ? null : v === 'true')}>
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
        <Input type="number" className="max-w-[120px]" value={minScore} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinScore(Number(e.target.value))} min={0} max={100} />
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saveCriteria.isPending || !name.trim() || !titlesText.trim() || selectedSites.length === 0}>
          {saveCriteria.isPending ? 'Saving...' : (initial ? 'Update' : 'Create')}
        </Button>
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
