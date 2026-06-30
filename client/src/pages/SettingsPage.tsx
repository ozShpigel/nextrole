import { useState, useEffect, useRef } from 'react';
import { useProfile, useProfileHistory } from '../lib/queries';
import { useSaveProfile, useRestoreHistory, useNormalizeProfile, useNormalizeProfileFile } from '../lib/mutations';
import type {
  ProfileResponse, StructuredProfile, ExperienceItem, SkillGroups, NormalizedProfile, HistoryField,
} from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
import { ChipInput } from '../components/ChipInput';
import { SaveResult, HistoryDropdown, type SaveResultData } from '../components/settings-shared';

// Editorial button — broadsheet stamp on the --ed-* palette.
type BtnVariant = 'default' | 'outline' | 'destructive' | 'secondary';
function Button(
  { variant = 'default', size, className = '', children, ...rest }:
  { variant?: BtnVariant; size?: 'sm' | 'default'; className?: string; children: React.ReactNode } &
  React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-none border font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-45 disabled:pointer-events-none';
  const sz = size === 'sm' ? 'px-3 py-[0.42rem] text-[0.64rem]' : 'px-4 py-[0.55rem] text-[0.68rem]';
  const variants: Record<BtnVariant, string> = {
    default:     'border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]',
    outline:     'bg-transparent border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]',
    destructive: 'bg-transparent border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10',
    secondary:   'border-[var(--ed-ink)] bg-[var(--ed-ink)] text-[var(--ed-paper)] hover:opacity-90',
  };
  return (
    <button type="button" className={`${base} ${sz} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

const EDITOR_CLS = 'w-full p-[1rem_1.1rem] border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 text-[var(--ed-ink)] font-code text-[0.82rem] resize-y outline-none leading-[1.7] text-left whitespace-pre-wrap transition-colors hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)]';
const FIELD_INPUT = 'w-full py-[0.5rem] px-[0.75rem] bg-transparent border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.85rem] font-code text-left transition-colors hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] focus:outline-none';
const FIELD_LABEL = 'text-[0.62rem] text-[var(--ed-ink-faint)] tracking-[0.16em] uppercase font-semibold';
const META_TEXT = 'text-[0.72rem] text-[var(--ed-ink-faint)] tabular-nums tracking-[0.05em] font-medium';

const EMPTY_SKILLS: SkillGroups = { languages: [], frameworks: [], infrastructure: [], databases: [], other: [] };
const EMPTY_PROFILE: StructuredProfile = {
  summary: '', seniority: '', domains: [], experience: [], skills: EMPTY_SKILLS,
  strengths: [], coreValues: [], rawExperienceText: '',
};

const lines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);
const csv = (s: string): string[] => s.split(',').map((l) => l.trim()).filter(Boolean);
const toLines = (a: string[]): string => (a ?? []).join('\n');
const toCsv = (a: string[]): string => (a ?? []).join(', ');

// Normalize a profile loaded from the API into a fully-populated shape so the
// controlled inputs never see undefined.
function hydrate(p?: StructuredProfile | null): StructuredProfile {
  return {
    ...EMPTY_PROFILE,
    ...(p ?? {}),
    skills: { ...EMPTY_SKILLS, ...(p?.skills ?? {}) },
    experience: p?.experience ?? [],
    domains: p?.domains ?? [],
    strengths: p?.strengths ?? [],
    coreValues: p?.coreValues ?? [],
  };
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<StructuredProfile>(EMPTY_PROFILE);
  const [original, setOriginal] = useState<StructuredProfile>(EMPTY_PROFILE);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveResultData | null>(null);
  const [normalizeError, setNormalizeError] = useState<string | null>(null);

  const profileQuery = useProfile();
  const saveProfileMutation = useSaveProfile();
  const normalizeMutation = useNormalizeProfile();
  const normalizeFileMutation = useNormalizeProfileFile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [initialized, setInitialized] = useState(false);

  function applyProfileData(data: ProfileResponse): void {
    const h = hydrate(data?.structured);
    setProfile(h);
    setOriginal(h);
    setLastUpdated(data?.updated_at ?? null);
  }

  useEffect(() => {
    if (profileQuery.data && !initialized) {
      applyProfileData(profileQuery.data as ProfileResponse);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQuery.data, initialized]);

  const loading = profileQuery.isLoading;
  const error = profileQuery.error?.message ?? null;
  const isDirty = JSON.stringify(profile) !== JSON.stringify(original);

  // Partial updates that also clear the stale save banner.
  function patch(p: Partial<StructuredProfile>): void {
    setProfile((prev) => ({ ...prev, ...p }));
    setResult(null);
  }
  function patchSkills(p: Partial<SkillGroups>): void {
    setProfile((prev) => ({ ...prev, skills: { ...prev.skills, ...p } }));
    setResult(null);
  }
  function patchRole(i: number, p: Partial<ExperienceItem>): void {
    setProfile((prev) => ({
      ...prev,
      experience: prev.experience.map((r, idx) => (idx === i ? { ...r, ...p } : r)),
    }));
    setResult(null);
  }
  function addRole(): void {
    patch({ experience: [...profile.experience, { title: '', company: '', dates: '', highlights: [] }] });
  }
  function removeRole(i: number): void {
    patch({ experience: profile.experience.filter((_, idx) => idx !== i) });
  }

  // Merge the extracted experience/skills; keep manual strengths/values + the raw paste.
  function applyNormalized(n: NormalizedProfile): void {
    setProfile((prev) => ({
      ...prev,
      summary: n.summary ?? '',
      seniority: n.seniority ?? '',
      domains: n.domains ?? [],
      experience: n.experience ?? [],
      skills: { ...EMPTY_SKILLS, ...(n.skills ?? {}) },
    }));
  }

  async function normalize(): Promise<void> {
    setNormalizeError(null);
    setResult(null);
    if (!profile.rawExperienceText.trim()) {
      setNormalizeError('Paste your experience and skills first.');
      return;
    }
    try {
      applyNormalized(await normalizeMutation.mutateAsync(profile.rawExperienceText) as NormalizedProfile);
    } catch (e) {
      setNormalizeError(`Normalization failed: ${(e as Error).message}`);
    }
  }

  async function onResumeFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setNormalizeError(null);
    setResult(null);
    try {
      applyNormalized(await normalizeFileMutation.mutateAsync(file) as NormalizedProfile);
    } catch (err) {
      setNormalizeError(`Couldn't parse résumé: ${(err as Error).message}`);
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    setResult(null);
    try {
      const data = await saveProfileMutation.mutateAsync(
        profile as unknown as Record<string, unknown>,
      ) as ProfileResponse;
      setLastUpdated(data?.updated_at ?? null);
      const h = hydrate(data?.structured ?? profile);
      setProfile(h);
      setOriginal(h);
      setResult({ type: 'success', message: 'Profile saved successfully' });
    } catch (e) {
      setResult({ type: 'error', message: `Error saving: ${(e as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <SettingsLoadingSkeleton />;

  return (
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-14 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 max-sm:px-5 max-sm:pt-10 max-sm:pb-16">

      <header className="mb-14 relative">
        <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
          <span>Vol. III · The Standards Desk</span>
          <span className="hidden sm:block text-[var(--ed-accent)]">Your candidate profile</span>
        </div>
        <h1 className="ed-display font-black text-[clamp(2.6rem,6.5vw,4.4rem)] leading-[0.9] tracking-[-0.022em] text-[var(--ed-ink)] pt-4">
          Settings
        </h1>
        <p className="mt-3 max-w-[600px] text-[var(--ed-ink-soft)] text-[0.98rem] leading-[1.65]">
          Your professional profile — the input Claude uses for job analysis and matching.
          Paste your experience and skills and let the normalizer structure them; add your
          strengths and core values by hand. The scoring prompts and model parameters are
          managed as server configuration.
        </p>
        <div className="mt-6 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
      </header>

      {error && (
        <div className="bg-[var(--ed-no)]/[0.07] border border-[var(--ed-no)]/30 py-[0.85rem] px-[1.15rem] mb-8 text-[var(--ed-no)] text-[0.85rem]">
          {error}
        </div>
      )}

      <section className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-section-01">
        <SectionHeader
          num="01"
          name="Professional Profile"
          right={<MetaPill>{lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleDateString('en-US')}` : 'Source: sample'}</MetaPill>}
        />

        {/* Experience & skills — upload a résumé, or paste + normalize */}
        <FieldGroup
          title="Experience & skills"
          desc="Upload your résumé (PDF or TXT) to fill Summary & Experience automatically, or paste your background and Normalize. Review and edit the result below."
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            onChange={onResumeFile}
            className="hidden"
            data-testid="resume-file-input"
          />
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={normalizeFileMutation.isPending}>
              {normalizeFileMutation.isPending ? 'Parsing résumé…' : 'Upload résumé'}
            </Button>
            <span className={META_TEXT}>PDF or TXT — fills Summary & Experience below</span>
          </div>
          <textarea
            className={`${EDITOR_CLS} min-h-[160px]`}
            value={profile.rawExperienceText}
            onChange={(e) => patch({ rawExperienceText: e.target.value })}
            placeholder="…or paste your roles, accomplishments, and skills here"
            dir="auto"
            spellCheck={false}
          />
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <Button size="sm" onClick={normalize} disabled={normalizeMutation.isPending || !profile.rawExperienceText.trim()}>
              {normalizeMutation.isPending ? 'Normalizing…' : 'Normalize'}
            </Button>
            <span className={META_TEXT}>{profile.rawExperienceText.length.toLocaleString()} chars</span>
            {normalizeError && <span className="text-[0.78rem] text-[var(--ed-no)]">{normalizeError}</span>}
          </div>
        </FieldGroup>

        {/* Normalized: summary / seniority / domains */}
        <FieldGroup title="Summary">
          <textarea
            className={`${EDITOR_CLS} min-h-[64px]`}
            value={profile.summary}
            onChange={(e) => patch({ summary: e.target.value })}
            placeholder="One or two factual sentences (auto-filled by Normalize; editable)."
            dir="auto"
            spellCheck={false}
          />
          <div className="grid grid-cols-2 gap-3 mt-3 max-sm:grid-cols-1">
            <label className="flex flex-col gap-[0.4rem]">
              <span className={FIELD_LABEL}>Seniority</span>
              <input className={FIELD_INPUT} value={profile.seniority ?? ''} onChange={(e) => patch({ seniority: e.target.value })} placeholder="e.g. Senior" />
            </label>
            <label className="flex flex-col gap-[0.4rem]">
              <span className={FIELD_LABEL}>Domains (comma-separated)</span>
              <input className={FIELD_INPUT} value={toCsv(profile.domains)} onChange={(e) => patch({ domains: csv(e.target.value) })} placeholder="e.g. fintech, healthtech" />
            </label>
          </div>
        </FieldGroup>

        {/* Experience items */}
        <FieldGroup title="Experience" desc="One entry per role.">
          <div className="flex flex-col gap-4">
            {profile.experience.map((role, i) => (
              <div key={i} className="border border-[var(--ed-rule)] bg-[var(--ed-panel)]/30 p-[1rem_1.1rem]">
                <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
                  <input className={FIELD_INPUT} value={role.title} onChange={(e) => patchRole(i, { title: e.target.value })} placeholder="Title" />
                  <input className={FIELD_INPUT} value={role.company} onChange={(e) => patchRole(i, { company: e.target.value })} placeholder="Company" />
                  <input className={FIELD_INPUT} value={role.dates} onChange={(e) => patchRole(i, { dates: e.target.value })} placeholder="Dates (e.g. 2021–Present)" />
                </div>
                <div className="mt-2 flex flex-col gap-[0.4rem]">
                  <span className={FIELD_LABEL}>Highlights (one per line)</span>
                  <textarea
                    className={`${EDITOR_CLS} min-h-[80px]`}
                    value={toLines(role.highlights)}
                    onChange={(e) => patchRole(i, { highlights: lines(e.target.value) })}
                    dir="auto"
                    spellCheck={false}
                  />
                </div>
                <div className="flex justify-end mt-2">
                  <Button variant="destructive" size="sm" onClick={() => removeRole(i)}>Remove role</Button>
                </div>
              </div>
            ))}
            <div><Button variant="outline" size="sm" onClick={addRole}>+ Add role</Button></div>
          </div>
        </FieldGroup>

        {/* Skills */}
        <FieldGroup title="Skills" desc="Comma-separated, grouped.">
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {([
              ['languages', 'Languages'],
              ['frameworks', 'Frameworks'],
              ['infrastructure', 'Infrastructure'],
              ['databases', 'Databases'],
              ['other', 'Other'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-[0.4rem]">
                <span className={FIELD_LABEL}>{label}</span>
                <input
                  className={FIELD_INPUT}
                  value={toCsv(profile.skills[key])}
                  onChange={(e) => patchSkills({ [key]: csv(e.target.value) } as Partial<SkillGroups>)}
                />
              </label>
            ))}
          </div>
        </FieldGroup>

        {/* Manual: strengths + core values */}
        <FieldGroup title="Strengths" desc="Manual — one per line. (Not auto-extracted.)">
          <textarea
            className={`${EDITOR_CLS} min-h-[96px]`}
            value={toLines(profile.strengths)}
            onChange={(e) => patch({ strengths: lines(e.target.value) })}
            placeholder="e.g. Clear written communication"
            dir="auto"
            spellCheck={false}
          />
        </FieldGroup>

        <FieldGroup title="Core values" desc="Manual — one per line. (Not auto-extracted.)">
          <textarea
            className={`${EDITOR_CLS} min-h-[96px]`}
            value={toLines(profile.coreValues)}
            onChange={(e) => patch({ coreValues: lines(e.target.value) })}
            placeholder="e.g. Sustainable pace over short-term heroics"
            dir="auto"
            spellCheck={false}
          />
        </FieldGroup>

        <div className="flex justify-between items-center mt-[1.1rem] pt-4 border-t border-dashed border-[var(--ed-rule)] relative max-sm:flex-col max-sm:gap-3 max-sm:items-stretch">
          <span className={META_TEXT}>
            {profile.experience.length} role(s) · {profile.strengths.length} strength(s) · {profile.coreValues.length} value(s)
          </span>
          <div className="flex gap-[0.55rem] max-sm:justify-end max-sm:flex-wrap">
            <HistoryButton field="profile" onRestored={applyProfileData} />
            {isDirty && (
              <Button variant="outline" size="sm" onClick={() => setProfile(original)} disabled={saving}>
                Discard changes
              </Button>
            )}
            <Button onClick={save} disabled={saving || !isDirty}>
              {saving ? 'Saving...' : 'Save profile'}
            </Button>
          </div>
        </div>
        {result && <SaveResult result={result} />}
      </section>

    </div>
    </div>
  );
}

function FieldGroup({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="mt-7">
      <h3 className="ed-display text-[1.15rem] font-semibold text-[var(--ed-ink)] tracking-[-0.005em]">{title}</h3>
      {desc && <p className="text-[0.82rem] text-[var(--ed-ink-soft)] leading-[1.6] mt-[0.2rem] mb-3 max-w-[640px]">{desc}</p>}
      {!desc && <div className="mb-3" />}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section Header — numbered §-mark                                    */
/* ------------------------------------------------------------------ */
function SectionHeader({ num, name, right }: { num: string; name: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end gap-4 mb-[0.65rem] flex-wrap pb-[0.55rem] border-b border-[var(--ed-rule-strong)] relative">
      <span className="absolute bottom-[-2px] left-0 w-12 h-[2px] bg-[var(--ed-accent)]" aria-hidden="true" />
      <span className="ed-display text-[2.6rem] font-black text-[var(--ed-ink-faint)] tracking-[-0.03em] tabular-nums leading-[0.78] shrink-0">{num}</span>
      <span className="ed-display text-[1.6rem] font-semibold text-[var(--ed-ink)] tracking-[-0.012em] leading-[1.15] pb-[0.1rem]">{name}</span>
      {right && <span className="ml-auto mb-[0.25rem]">{right}</span>}
    </div>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block text-[0.6rem] py-[0.24rem] px-[0.6rem] tracking-[0.12em] uppercase font-semibold tabular-nums border text-[var(--ed-ink-faint)] border-[var(--ed-rule)] bg-[var(--ed-panel)]/40">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* History Button + dropdown                                          */
/* ------------------------------------------------------------------ */
function HistoryButton({ field, onRestored }: { field: HistoryField; onRestored: (data: ProfileResponse) => void }) {
  return (
    <HistoryDropdown<HistoryField, ProfileResponse>
      field={field}
      onRestored={onRestored}
      useHistory={useProfileHistory}
      useRestore={useRestoreHistory}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Loading Skeleton                                                   */
/* ------------------------------------------------------------------ */
function SettingsLoadingSkeleton() {
  return (
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-14 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 max-sm:px-5" role="status" aria-live="polite" aria-label="Loading settings">
      <header className="mb-12 relative" aria-hidden="true">
        <div className="pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">Vol. III · The Standards Desk</div>
        <h1 className="ed-display text-[clamp(2.6rem,6.5vw,4.4rem)] font-black text-[var(--ed-ink)] leading-[0.9] pt-4 mb-4 tracking-[-0.022em] animate-in fade-in duration-300">
          Settings
        </h1>
        <Skeleton className="w-[62%] h-[14px] rounded-[4px] mt-2" />
        <div className="mt-[1.4rem] border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
      </header>

      <section className="mb-10 pb-8 border-b border-[var(--ed-rule)] animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: '280ms' }} aria-hidden="true">
        <div className="flex items-baseline gap-[0.85rem] mb-4">
          <span className="ed-display text-[2.4rem] font-black text-[var(--ed-ink-faint)] tracking-[-0.03em] leading-none tabular-nums relative">
            01
            <span className="absolute bottom-[-0.35rem] left-0 w-[2rem] h-[2px] bg-[var(--ed-accent)]" />
          </span>
          <Skeleton className="w-[180px] h-5 rounded-[4px]" />
          <Skeleton className="w-[92px] h-[18px] rounded-[4px] ml-auto max-[720px]:hidden" />
        </div>
        <Skeleton className="w-[68%] h-3 rounded-[4px]" />
        <div className="bg-[var(--ed-panel)]/40 border border-[var(--ed-rule)] p-[1.2rem] mt-4 flex flex-col gap-[0.85rem]">
          <Skeleton className="h-3 rounded-[4px] w-3/4" />
          <Skeleton className="h-3 rounded-[4px] w-full" />
          <Skeleton className="h-3 rounded-[4px] w-[45%]" />
        </div>
      </section>

      <div className="mt-11 pt-[1.4rem] border-t border-dashed border-[var(--ed-rule)] flex items-center gap-[0.7rem] ed-display text-[1rem] text-[var(--ed-ink-faint)] italic tracking-[-0.005em] relative">
        <span className="ed-display text-[1.2rem] text-[var(--ed-accent)] opacity-80 not-italic" aria-hidden="true">§</span>
        <span aria-hidden="true">Loading...</span>
        <span className="sr-only">Loading settings</span>
      </div>
    </div>
    </div>
  );
}
