import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { User, FileText, Upload, RefreshCw, Award, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProfile, useResumeFile } from '../lib/queries';
import { useSaveProfile, useNormalizeProfileFile } from '../lib/mutations';
import { apiUrl } from '../lib/api';
import type { ProfileResponse, StructuredProfile, SkillGroups, NormalizedProfile } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
import { ChipInput } from '../components/ChipInput';

type Tab = 'about' | 'values' | 'resume';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}


const FIELD_INPUT = 'w-full py-[0.5rem] px-[0.75rem] bg-transparent border border-[var(--ed-rule)] text-[var(--ed-ink)] text-[0.85rem] font-code text-left transition-colors hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)] focus:outline-none';
const FIELD_LABEL = 'text-[0.62rem] text-[var(--ed-ink-faint)] tracking-[0.16em] uppercase font-semibold';
const META_TEXT = 'text-[0.72rem] text-[var(--ed-ink-faint)] tabular-nums tracking-[0.05em] font-medium';

const EMPTY_SKILLS: SkillGroups = { languages: [], frameworks: [], infrastructure: [], databases: [], other: [] };
const EMPTY_PROFILE: StructuredProfile = {
  fullName: '', email: '', phone: '', location: '',
  summary: '', seniority: '', domains: [], experience: [], skills: EMPTY_SKILLS,
  education: [], strengths: [], coreValues: [], rawExperienceText: '',
};

// Manual, never auto-extracted — kept editable even though everything else
// (Summary/Experience/Skills/Education) only comes from Upload/Paste now.
const STRENGTH_SUGGESTIONS = [
  'Complexity reduction', 'Reliability mindset', 'Understanding-to-enablement', 'Automation leverage',
  'End-to-end ownership', 'Persistent depth', 'Sustainable delivery', 'Trade-off thinking',
];
const VALUE_SUGGESTIONS = [
  'Clarity over complexity', 'Reliability over shortcuts', 'Ownership and accountability',
  'Perseverance and follow-through', 'Honesty and transparency', 'Continuous growth',
  'Enabling others', 'Respect for focus', 'Sustainability over heroics', 'Pragmatism over perfection',
];

// Normalize a profile loaded from the API into a fully-populated shape so the
// controlled inputs never see undefined.
function hydrate(p?: StructuredProfile | null): StructuredProfile {
  return {
    ...EMPTY_PROFILE,
    ...(p ?? {}),
    skills: { ...EMPTY_SKILLS, ...(p?.skills ?? {}) },
    experience: p?.experience ?? [],
    domains: p?.domains ?? [],
    education: p?.education ?? [],
    strengths: p?.strengths ?? [],
    coreValues: p?.coreValues ?? [],
  };
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<StructuredProfile>(EMPTY_PROFILE);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [normalizeError, setNormalizeError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('about');
  const [pdfPage, setPdfPage] = useState(1);

  const profileQuery = useProfile();
  const resumeFileQuery = useResumeFile();
  const saveProfileMutation = useSaveProfile();
  const normalizeFileMutation = useNormalizeProfileFile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [initialized, setInitialized] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (profileQuery.data && !initialized) {
      const data = profileQuery.data as ProfileResponse;
      setProfile(hydrate(data.structured));
      setLastUpdated(data.updated_at ?? null);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQuery.data, initialized]);

  const loading = profileQuery.isLoading;
  const error = profileQuery.error?.message ?? null;

  // Every field on this page auto-saves — no "Save profile" button. Each
  // call PUTs the full profile (the only save endpoint that exists), just
  // triggered immediately instead of behind a button.
  async function persist(next: StructuredProfile): Promise<void> {
    setProfile(next);
    setSaveError(null);
    try {
      const data = await saveProfileMutation.mutateAsync(next as unknown as Record<string, unknown>) as ProfileResponse;
      setLastUpdated(data?.updated_at ?? null);
      setProfile(hydrate(data?.structured ?? next));
    } catch (e) {
      setSaveError(`Couldn't save: ${(e as Error).message}`);
    }
  }

  function saveContact(field: 'fullName' | 'email' | 'phone' | 'location', value: string): void {
    persist({ ...profile, [field]: value });
  }

  function saveChips(field: 'strengths' | 'coreValues', value: string[]): void {
    persist({ ...profile, [field]: value });
  }

  // Merge the extracted experience/skills/education/contact and save
  // immediately — no review UI, so there's no reason to wait for a click.
  // Contact fields only overwrite when the source actually stated them.
  async function normalizeAndSave(run: () => Promise<NormalizedProfile>): Promise<void> {
    setNormalizeError(null);
    try {
      const n = await run();
      await persist({
        ...profile,
        fullName: n.fullName || profile.fullName,
        email: n.email || profile.email,
        phone: n.phone || profile.phone,
        location: n.location || profile.location,
        summary: n.summary ?? '',
        seniority: n.seniority ?? '',
        domains: n.domains ?? [],
        experience: n.experience ?? [],
        skills: { ...EMPTY_SKILLS, ...(n.skills ?? {}) },
        education: n.education ?? [],
      });
      resumeFileQuery.refetch();
    } catch (e) {
      setNormalizeError(`Couldn't parse résumé: ${(e as Error).message}`);
    }
  }

  async function onResumeFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    await normalizeAndSave(() => normalizeFileMutation.mutateAsync(file) as Promise<NormalizedProfile>);
  }

  // Homepage "Upload your résumé" CTA lands here with ?upload=1 — open the
  // file picker as soon as the page (and its hidden input) has rendered,
  // then strip the param so a refresh/back-nav doesn't reopen it.
  useEffect(() => {
    if (!loading && searchParams.get('upload') === '1') {
      fileInputRef.current?.click();
      setSearchParams((prev) => {
        prev.delete('upload');
        return prev;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // A freshly-uploaded (or reloaded) résumé always starts back on page 1.
  useEffect(() => {
    setPdfPage(1);
  }, [resumeFileQuery.data?.fileName, resumeFileQuery.data?.uploadedAt]);

  if (loading) return <SettingsLoadingSkeleton />;

  const resumeFile = resumeFileQuery.data;
  const latestTitle = profile.experience[0]?.title || null;

  return (
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[1000px] mx-auto px-8 pt-14 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 max-sm:px-5 max-sm:pt-10 max-sm:pb-16">

      {error && (
        <div className="bg-[var(--ed-no)]/[0.07] border border-[var(--ed-no)]/30 py-[0.85rem] px-[1.15rem] mb-8 text-[var(--ed-no)] text-[0.85rem]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[220px_1fr] gap-14 max-sm:grid-cols-1 max-sm:gap-8 items-start">

        {/* Left rail — profile card + tab nav, mirrors the dreamworkhq layout
            this was modeled on. Only About You / Resume are real tabs here —
            NextRole has no Job preferences/Work vault/Subscription etc. */}
        <aside className="max-sm:order-first">
          <div className="flex flex-col items-start gap-[0.35rem] mb-8">
            <div className="w-14 h-14 rounded-full bg-[var(--ed-accent)]/15 border border-[var(--ed-accent)]/40 flex items-center justify-center ed-display text-[1.1rem] font-bold text-[var(--ed-accent)] mb-3">
              {initials(profile.fullName || '?')}
            </div>
            <h2 className="ed-display text-[1.15rem] font-bold text-[var(--ed-ink)] leading-tight">
              {profile.fullName || 'Your profile'}
            </h2>
            {latestTitle && <span className="text-[0.8rem] text-[var(--ed-ink-soft)]">{latestTitle}</span>}
            {profile.location && <span className="text-[0.76rem] text-[var(--ed-ink-faint)]" dir="auto">{profile.location}</span>}
          </div>

          <nav className="flex flex-col gap-[0.35rem] max-sm:flex-row max-sm:flex-wrap">
            <SidebarTab active={activeTab === 'about'} onClick={() => setActiveTab('about')} icon={<User size={15} />} label="About You" />
            <SidebarTab active={activeTab === 'values'} onClick={() => setActiveTab('values')} icon={<Award size={15} />} label="Work Values" />
            <SidebarTab active={activeTab === 'resume'} onClick={() => setActiveTab('resume')} icon={<FileText size={15} />} label="Resume" />
          </nav>
        </aside>

        <div>
          {activeTab === 'about' && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-about-you">
              <TabHeader icon={<User size={18} />} name="About You" right={<MetaPill>{lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleDateString('en-US')}` : 'Source: sample'}</MetaPill>} />

              <div className="border border-[var(--ed-rule)] bg-[var(--ed-panel)]/30 divide-y divide-[var(--ed-rule)]">
                <ContactRow label="Full name" value={profile.fullName} onSave={(v) => saveContact('fullName', v)} />
                <ContactRow label="Email" type="email" value={profile.email} onSave={(v) => saveContact('email', v)} />
                <ContactRow label="Phone" value={profile.phone} onSave={(v) => saveContact('phone', v)} />
                <ContactRow label="Location" value={profile.location} onSave={(v) => saveContact('location', v)} />
              </div>
              {saveError && <p className="text-[0.78rem] text-[var(--ed-no)] mt-2">{saveError}</p>}
            </section>
          )}

          {activeTab === 'values' && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-work-values">
              <TabHeader icon={<Award size={18} />} name="Work Values" />

              {/* Manual: strengths + core values. Capped at 3 each so the matching
                  signal stays sharp — a long list dilutes every item's weight in
                  the search queries and the advisor ranking. Nothing else auto-
                  extracts these, so they stay editable even though the rest of
                  the structured profile no longer shows in this UI. */}
              <FieldGroup title="Strengths" desc="Manual, max 3 — pick the ones that should steer job matching." first>
                <ChipInput
                  value={profile.strengths}
                  onChange={(v) => saveChips('strengths', v)}
                  placeholder="e.g. Clear written communication"
                  ariaLabel="Add a strength"
                  suggestions={STRENGTH_SUGGESTIONS}
                  max={3}
                />
              </FieldGroup>

              <FieldGroup title="Core values" desc="Manual, max 3 — pick the ones that should steer job matching.">
                <ChipInput
                  value={profile.coreValues}
                  onChange={(v) => saveChips('coreValues', v)}
                  placeholder="e.g. Sustainable pace over short-term heroics"
                  ariaLabel="Add a core value"
                  suggestions={VALUE_SUGGESTIONS}
                  max={3}
                />
              </FieldGroup>
            </section>
          )}

          {activeTab === 'resume' && (
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-resume">
              <TabHeader
                icon={<FileText size={18} />}
                name="Resume"
                right={
                  <ResumeActionButton
                    hasResume={!!resumeFile}
                    pending={normalizeFileMutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                  />
                }
              />

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                onChange={onResumeFile}
                className="hidden"
                data-testid="resume-file-input"
              />

              {resumeFile ? (
                <div className="bg-[var(--ed-panel)]/40 border border-[var(--ed-rule)] overflow-hidden">
                  {resumeFile.contentType === 'application/pdf' ? (
                    <>
                      <embed
                        key={pdfPage}
                        src={`${apiUrl('/match/profile/resume-file/download')}#toolbar=0&navpanes=0&scrollbar=0&view=Fit&page=${pdfPage}`}
                        type="application/pdf"
                        className="w-full h-[85vh] min-h-[700px] block"
                      />
                      {(resumeFile.pageCount ?? 1) > 1 && (
                        <PdfPager
                          page={pdfPage}
                          pageCount={resumeFile.pageCount!}
                          onChange={setPdfPage}
                        />
                      )}
                    </>
                  ) : (
                    <pre className="p-5 max-h-[600px] overflow-y-auto text-[0.82rem] text-[var(--ed-ink)] font-code leading-[1.7] whitespace-pre-wrap">{resumeFile.textContent}</pre>
                  )}
                </div>
              ) : (
                <div className="border border-dashed border-[var(--ed-rule)] py-16 px-8 flex flex-col items-center gap-3 text-center">
                  <FileText size={26} className="text-[var(--ed-ink-faint)]" aria-hidden="true" />
                  <p className="text-[var(--ed-ink-soft)] text-[0.88rem]">No résumé uploaded yet — use the button above.</p>
                </div>
              )}
              {normalizeError && <p className="text-[0.78rem] text-[var(--ed-no)] mt-3">{normalizeError}</p>}
            </section>
          )}
        </div>
      </div>

    </div>
    </div>
  );
}

function SidebarTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-[0.65rem] py-[0.65rem] px-[0.9rem] rounded-lg text-[0.84rem] font-medium transition-colors text-left ${
        active
          ? 'bg-[var(--ed-accent)]/12 text-[var(--ed-accent)]'
          : 'text-[var(--ed-ink-soft)] hover:bg-[var(--ed-panel)]/50 hover:text-[var(--ed-ink)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// Replaces the browser's native PDF viewer chrome (toolbar + the floating
// "Page X of Y" scroll-nav pill) with a plain prev/next bar — the embed is
// locked to one page at a time via the `view=Fit&page=N` URL fragment, so
// there's nothing left to scroll past.
function PdfPager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-4 py-[0.6rem] border-t border-[var(--ed-rule)]">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="text-[var(--ed-ink-soft)] hover:text-[var(--ed-accent)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronLeft size={18} />
      </button>
      <span className={META_TEXT}>Page {page} of {pageCount}</span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Next page"
        className="text-[var(--ed-ink-soft)] hover:text-[var(--ed-accent)] transition-colors disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

// The primary action for the Resume tab — upload/replace. Bigger and more
// tactile than the standard Button: filled pill, soft accent glow that
// intensifies on hover/lift, icon that nudges up on hover. Lives in the
// TabHeader's top-right slot rather than buried under the preview.
function ResumeActionButton({ hasResume, pending, onClick }: { hasResume: boolean; pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="group inline-flex items-center gap-2 rounded-full bg-[var(--ed-accent)] text-[var(--ed-paper)] pl-4 pr-5 py-[0.6rem] text-[0.76rem] font-semibold uppercase tracking-[0.06em] shadow-[0_2px_14px_-4px_color-mix(in_oklab,var(--ed-accent)_60%,transparent)] transition-all duration-200 hover:bg-[var(--ed-accent-deep)] hover:-translate-y-[1.5px] hover:shadow-[0_8px_22px_-4px_color-mix(in_oklab,var(--ed-accent)_70%,transparent)] active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none disabled:translate-y-0 disabled:shadow-none"
    >
      {pending ? (
        <RefreshCw size={15} className="animate-spin" aria-hidden="true" />
      ) : (
        <Upload size={15} className="transition-transform duration-200 group-hover:-translate-y-[1.5px]" aria-hidden="true" />
      )}
      {pending ? 'Parsing…' : hasResume ? 'Replace résumé' : 'Upload résumé'}
    </button>
  );
}

function TabHeader({ icon, name, right }: { icon: React.ReactNode; name: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[0.65rem] mb-8 pb-[0.85rem] border-b border-[var(--ed-rule-strong)]">
      <span className="text-[var(--ed-ink-faint)]" aria-hidden="true">{icon}</span>
      <h1 className="ed-display text-[1.5rem] font-bold text-[var(--ed-ink)] tracking-[-0.012em]">{name}</h1>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

// Row with an inline "Edit" toggle — click Edit, type, Enter/blur to confirm
// and auto-save; Escape reverts. Matches the dreamworkhq "About you" pattern.
function ContactRow(
  { label, value, onSave, type = 'text' }:
  { label: string; value?: string | null; onSave: (v: string) => void; type?: string },
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  function confirm(): void {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value ?? '')) onSave(trimmed);
  }

  function cancel(): void {
    setDraft(value ?? '');
    setEditing(false);
  }

  return (
    <div className="flex items-center justify-between gap-3 py-[1.1rem] px-[1.4rem]">
      <span className={FIELD_LABEL}>{label}</span>
      {editing ? (
        <input
          autoFocus
          type={type}
          className={`${FIELD_INPUT} max-w-[300px]`}
          value={draft}
          dir="auto"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={confirm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') cancel();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-3 text-[0.88rem] text-[var(--ed-ink)] hover:text-[var(--ed-accent)] transition-colors"
        >
          <span dir="auto">{value || <span className="text-[var(--ed-ink-faint)] italic font-normal">Not set</span>}</span>
          <span className="text-[0.6rem] uppercase tracking-[0.1em] text-[var(--ed-ink-faint)] font-semibold">Edit</span>
        </button>
      )}
    </div>
  );
}

function FieldGroup({ title, desc, children, first }: { title: string; desc?: string; children: React.ReactNode; first?: boolean }) {
  return (
    <div className={first ? '' : 'mt-9'}>
      <h3 className="ed-display text-[1.15rem] font-semibold text-[var(--ed-ink)] tracking-[-0.005em]">{title}</h3>
      {desc && <p className="text-[0.82rem] text-[var(--ed-ink-soft)] leading-[1.6] mt-[0.3rem] mb-4 max-w-[640px]">{desc}</p>}
      {!desc && <div className="mb-4" />}
      {children}
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
/* Loading Skeleton                                                   */
/* ------------------------------------------------------------------ */
function SettingsLoadingSkeleton() {
  return (
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[1000px] mx-auto px-8 pt-14 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 max-sm:px-5" role="status" aria-live="polite" aria-label="Loading profile">
      <div className="grid grid-cols-[220px_1fr] gap-14 max-sm:grid-cols-1" aria-hidden="true">
        <aside>
          <div className="flex flex-col items-start gap-[0.4rem] mb-6">
            <Skeleton className="w-14 h-14 rounded-full mb-1" />
            <Skeleton className="w-[110px] h-4 rounded-[4px]" />
            <Skeleton className="w-[80px] h-3 rounded-[4px]" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="w-full h-8 rounded-lg" />
            <Skeleton className="w-full h-8 rounded-lg" />
          </div>
        </aside>

        <section className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: '180ms' }}>
          <Skeleton className="w-[140px] h-6 rounded-[4px] mb-5" />
          <div className="bg-[var(--ed-panel)]/40 border border-[var(--ed-rule)] p-[1.2rem] flex flex-col gap-[0.85rem]">
            <Skeleton className="h-3 rounded-[4px] w-3/4" />
            <Skeleton className="h-3 rounded-[4px] w-full" />
            <Skeleton className="h-3 rounded-[4px] w-[45%]" />
          </div>
        </section>
      </div>

      <div className="mt-11 pt-[1.4rem] border-t border-dashed border-[var(--ed-rule)] flex items-center gap-[0.7rem] ed-display text-[1rem] text-[var(--ed-ink-faint)] italic tracking-[-0.005em] relative">
        <span className="ed-display text-[1.2rem] text-[var(--ed-accent)] opacity-80 not-italic" aria-hidden="true">§</span>
        <span aria-hidden="true">Loading...</span>
        <span className="sr-only">Loading profile</span>
      </div>
    </div>
    </div>
  );
}
