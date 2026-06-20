import { useState, useEffect } from 'react';
import { useProfile, useProfileHistory } from '../lib/queries';
import { useSaveProfile, useRestoreHistory } from '../lib/mutations';
import type { ProfileResponse, HistoryField } from '../lib/types';
import { Skeleton } from '../components/ui/skeleton';
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

const EDITOR_CLS = 'w-full p-[1.4rem_1.5rem] border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 text-[var(--ed-ink)] font-code text-[0.85rem] resize-y outline-none leading-[1.8] text-left whitespace-pre-wrap transition-colors hover:border-[var(--ed-ink-faint)] focus:border-[var(--ed-accent)]';
const META_TEXT = 'text-[0.72rem] text-[var(--ed-ink-faint)] tabular-nums tracking-[0.05em] font-medium';

const estimateTokens = (text: string | undefined | null): number => Math.ceil((text?.length || 0) / 4);

export default function SettingsPage() {
  const [profile, setProfile] = useState<string>('');
  const [originalProfile, setOriginalProfile] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [profileResult, setProfileResult] = useState<SaveResultData | null>(null);

  const profileQuery = useProfile();
  const saveProfileMutation = useSaveProfile();
  const [initialized, setInitialized] = useState(false);

  // Reset editor state (and its "original" baseline) from a profile response.
  // Used on first load and after a history restore.
  function applyProfileData(data: ProfileResponse): void {
    const content = data?.content || '';
    setProfile(content);
    setOriginalProfile(content);
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

  const isProfileDirty = profile !== originalProfile;

  async function saveProfile(): Promise<void> {
    setSavingProfile(true);
    setProfileResult(null);
    try {
      const data = await saveProfileMutation.mutateAsync({ content: profile }) as ProfileResponse;
      setLastUpdated(data?.updated_at ?? null);
      setOriginalProfile(profile);
      setProfileResult({ type: 'success', message: 'Profile saved successfully' });
    } catch (e) {
      setProfileResult({ type: 'error', message: `Error saving: ${(e as Error).message}` });
    } finally {
      setSavingProfile(false);
    }
  }

  if (loading) return <SettingsLoadingSkeleton />;

  return (
    <div className="editorial editorial-grain min-h-screen">
    <div className="relative z-[1] max-w-[960px] mx-auto px-8 pt-14 pb-32 animate-in fade-in slide-in-from-bottom-1 duration-500 max-sm:px-5 max-sm:pt-10 max-sm:pb-16">

      <header className="mb-14 relative">
        <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
          <span>Vol. III · The Standards Desk</span>
          <span className="hidden sm:block text-[var(--ed-accent)]">House style &amp; profile</span>
        </div>
        <h1 className="ed-display font-black text-[clamp(2.6rem,6.5vw,4.4rem)] leading-[0.9] tracking-[-0.022em] text-[var(--ed-ink)] pt-4">
          Settings
        </h1>
        <p className="mt-3 max-w-[560px] text-[var(--ed-ink-soft)] text-[0.98rem] leading-[1.65]">
          Your professional profile — the input Claude uses for job analysis and matching.
          The scoring prompts and model parameters are managed as server configuration.
        </p>
        <div className="mt-6 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
      </header>

      {error && (
        <div className="bg-[var(--ed-no)]/[0.07] border border-[var(--ed-no)]/30 py-[0.85rem] px-[1.15rem] mb-8 text-[var(--ed-no)] text-[0.85rem]">
          {error}
        </div>
      )}

      {/* 01 — Profile Editor */}
      <section className="mb-16 relative animate-in fade-in slide-in-from-bottom-2 duration-300" id="settings-section-01">
        <SectionHeader
          num="01"
          name="Professional Profile"
          right={<MetaPill>{lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleDateString('en-US')}` : 'Source: local file'}</MetaPill>}
        />
        <p className="text-[0.92rem] text-[var(--ed-ink-soft)] leading-[1.75] mt-[0.85rem] mb-6 max-w-[640px]">
          The professional profile sent to Claude for job analysis and matching. Changes take effect immediately after saving.
        </p>
        <textarea
          className={`${EDITOR_CLS} min-h-[420px]`}
          value={profile}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setProfile(e.target.value); setProfileResult(null); }}
          dir="auto"
          spellCheck={false}
        />
        <div className="flex justify-between items-center mt-[1.1rem] pt-4 border-t border-dashed border-[var(--ed-rule)] relative max-sm:flex-col max-sm:gap-3 max-sm:items-stretch">
          <span className={`${META_TEXT} inline-flex items-baseline gap-[0.35rem]`}>
            {profile.length.toLocaleString()} chars
            <span className="ml-2 text-[var(--ed-ink-faint)] text-[0.7rem] tracking-[0.04em] font-normal pl-[0.6rem] border-l border-[var(--ed-rule)]">· ≈{estimateTokens(profile).toLocaleString()} tokens</span>
          </span>
          <div className="flex gap-[0.55rem] max-sm:justify-end max-sm:flex-wrap">
            <HistoryButton field="content" onRestored={applyProfileData} />
            {isProfileDirty && (
              <Button variant="outline" size="sm" onClick={() => setProfile(originalProfile)} disabled={savingProfile}>
                Discard changes
              </Button>
            )}
            <Button
              onClick={saveProfile}
              disabled={savingProfile || !isProfileDirty}
            >
              {savingProfile ? 'Saving...' : 'Save profile'}
            </Button>
          </div>
        </div>
        {profileResult && (
          <SaveResult result={profileResult} />
        )}
      </section>

    </div>
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

// Small editorial meta-pill (Updated …).
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

      {/* Section ghost - profile editor */}
      <section
        className="mb-10 pb-8 border-b border-[var(--ed-rule)] animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: '280ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-[0.85rem] mb-4">
          <span className="ed-display text-[2.4rem] font-black text-[var(--ed-ink-faint)] tracking-[-0.03em] leading-none tabular-nums relative">
            01
            <span className="absolute bottom-[-0.35rem] left-0 w-[2rem] h-[2px] bg-[var(--ed-accent)]" />
          </span>
          <Skeleton className="w-[160px] h-5 rounded-[4px]" />
          <Skeleton className="w-[92px] h-[18px] rounded-[4px] ml-auto max-[720px]:hidden" />
        </div>
        <Skeleton className="w-[68%] h-3 rounded-[4px]" />
        {/* Editor preview */}
        <div className="relative bg-[var(--ed-panel)]/40 border border-[var(--ed-rule)] p-[1.2rem_1.25rem_1.35rem] pl-12 mt-4 overflow-hidden">
          <div className="absolute inset-0 right-auto w-9 bg-[var(--ed-panel)]/60 border-r border-[var(--ed-rule)] flex flex-col justify-around py-[0.9rem]">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <span key={i} className="block w-[0.45rem] h-px bg-[var(--ed-ink-faint)]/40 ml-auto mr-[0.45rem]" />
            ))}
          </div>
          <div className="flex flex-col gap-[0.85rem] leading-[1.75]">
            <Skeleton className="h-3 rounded-[4px] w-3/4" />
            <Skeleton className="h-3 rounded-[4px] w-full" />
            <Skeleton className="h-3 rounded-[4px] w-[45%]" />
            <Skeleton className="h-3 rounded-[4px] w-full" />
            <Skeleton className="h-3 rounded-[4px] w-3/4" />
          </div>
        </div>
      </section>

      {/* Cycling subtitle */}
      <div className="mt-11 pt-[1.4rem] border-t border-dashed border-[var(--ed-rule)] flex items-center gap-[0.7rem] ed-display text-[1rem] text-[var(--ed-ink-faint)] italic tracking-[-0.005em] relative">
        <span className="ed-display text-[1.2rem] text-[var(--ed-accent)] opacity-80 not-italic" aria-hidden="true">§</span>
        <span aria-hidden="true">Loading...</span>
        <span className="sr-only">Loading settings</span>
      </div>
    </div>
    </div>
  );
}
