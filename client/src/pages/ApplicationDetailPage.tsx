import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApplicationDetail } from '../lib/queries';
import { useGenerateCompanySummary, useGenerateWhyWorkHere, useGeneratePack } from '../lib/mutations';
import { StatusBadge } from '../components/Status';
import CollapsibleSection from '../components/CollapsibleSection';
import AnalysisCard, { edVerdictColor } from '../components/AnalysisCard';
import { NoteList, NoteModal } from '../components/Notes';
import { CompanyAvatar } from '../components/CompanyAvatar';
import { hasRealJobUrl } from '../lib/format';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, Sparkles, FileCheck, RefreshCw } from 'lucide-react';
import type { Interview } from '../lib/types';

// Shared editorial button styles
const ED_BTN = 'rounded-full border px-3.5 py-[0.45rem] text-[13px] font-medium transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;

// Section heading (plain sans + heavy rule — serif stays scoped to the logo/empty states)
function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="font-medium text-[16px] tracking-[-0.01em] text-[var(--ed-ink)]">{title}</span>
        {action}
      </div>
      <div className="border-t border-[var(--ed-rule-strong)] mb-4" />
    </>
  );
}

interface Note {
  id: string;
  category?: string;
  content: string;
  createdAt: string;
}

interface StatusUpdate {
  timestamp: string;
  fromStatus: string;
  toStatus: string;
  note?: string;
}

interface Application {
  id: string;
  jobTitle: string;
  company: string;
  companyLogo?: string | null;
  status: string;
  matchScore: number | null;
  matchVerdict: string | null;
  matchAnalysis: string | null;
  jobDescription: string | null;
  jobUrl: string | null;
  updatedAt: string;
  salary: string | null;
  companySummary: string | null;
  whyWorkHere: string | null;
  companyNews: string | null;
  glassdoorData: string | null;
  analystSnapshotInput: string | null;
  analystSnapshotOutput: string | null;
  evaluatorSnapshotInput: string | null;
  evaluatorSnapshotOutput: string | null;
}

interface ApplicationDetailData {
  application: Application;
  interviews: Interview[];
  notes: Note[];
  statusUpdates: StatusUpdate[];
  hasPack: boolean;
  packGeneratedAt: string | null;
}

type ModalState =
  | { type: 'note' }
  | null;

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalState>(null);

  const detailQuery = useApplicationDetail(id!);
  const generatePackMutation = useGeneratePack();

  function closeAndReload(): void {
    setModal(null);
    queryClient.invalidateQueries({ queryKey: ['applications', id] });
  }

  function refetch(): void {
    queryClient.invalidateQueries({ queryKey: ['applications', id] });
  }

  if (detailQuery.isLoading) return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="relative z-[1] max-w-[1100px] mx-auto px-8 pt-12 pb-16 max-[640px]:px-5">
        <ApplicationDetailLoadingSkeleton />
      </div>
    </div>
  );

  const data = detailQuery.data as ApplicationDetailData | undefined;
  if (!data) return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="relative z-[1] max-w-[1100px] mx-auto px-8 pt-12 pb-16 max-[640px]:px-5">
        <ApplicationDetailLoadingSkeleton />
      </div>
    </div>
  );

  const { application: app, notes, hasPack } = data;
  const packPending = generatePackMutation.isPending;
  // Once an application has moved past the "deciding to apply" stage, the pack
  // that got it there is assumed to exist — the pack page itself still offers
  // a Generate CTA for the rare case a pack was never made (e.g. mailbot-applied).
  const showReviewPack = hasPack || app.status !== 'DecidedToApply';

  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="relative z-[1] max-w-[1400px] mx-auto px-8 pt-12 pb-16 max-[640px]:px-5">
        <Link to="/active" className="text-[var(--ed-accent)] cursor-pointer text-[13px] font-medium tracking-[0.02em] mb-7 inline-flex items-center gap-[0.4rem] transition-all hover:-translate-x-[3px]">&larr; Back to Active</Link>

        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-8 items-start">
          {/* Left rail — job summary card + actions + this application's own history */}
          <div className="flex flex-col gap-6 lg:sticky lg:top-8">
            <div className="border border-[var(--ed-rule)] bg-[var(--ed-panel)] p-6 shadow-[0_6px_16px_-4px_rgba(0,0,0,0.45)]">
              <CompanyAvatar name={app.company} logo={app.companyLogo} size={56} />
              <div className="mt-4 flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-medium uppercase tracking-[0.1em] text-[var(--ed-ink-faint)]">{app.company}</span>
                <StatusBadge status={app.status} />
              </div>
              <h2 className="font-medium text-[28px] leading-[1.15] tracking-[-0.01em] text-[var(--ed-ink)] mt-1">{app.jobTitle}</h2>
              <DaysInStage updatedAt={app.updatedAt} />

              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-[28px] font-medium leading-none tabular-nums" style={{ color: edVerdictColor(app.matchVerdict) }}>{app.matchScore ?? '-'}</span>
                <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-[var(--ed-ink-faint)]">{app.matchVerdict || ''}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                className={`${ED_PRIMARY} w-full inline-flex items-center justify-center gap-[0.35rem]`}
                disabled={packPending && !showReviewPack}
                onClick={() => (showReviewPack ? navigate(`/tracker/${app.id}/pack`) : generatePackMutation.mutate(app.id))}
              >
                {packPending && !showReviewPack
                  ? <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
                  : showReviewPack ? <FileCheck size={13} aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
                {showReviewPack ? 'Review Pack' : 'Generate Pack'}
              </button>
              <div className="flex gap-2 flex-wrap">
                {hasRealJobUrl(app.jobUrl) && (
                  <a href={app.jobUrl!} target="_blank" rel="noopener noreferrer" className={`${ED_GHOST} inline-flex items-center gap-[0.35rem]`}>
                    <ExternalLink size={13} aria-hidden="true" />
                    Original
                  </a>
                )}
                <Link to={`/practice-interview?applicationId=${app.id}&company=${encodeURIComponent(app.company)}&jobTitle=${encodeURIComponent(app.jobTitle)}`} className={ED_GHOST}>
                  Practice Interview
                </Link>
              </div>
              <button type="button" className={ED_GHOST} onClick={() => setModal({ type: 'note' })}>Add Note</button>
            </div>

            {/* Notes */}
            <CollapsibleSection title={`Notes (${notes.length})`}>
              <NoteList notes={notes} onRefresh={refetch} />
            </CollapsibleSection>
          </div>

          {/* Right pane — AI insights and analysis, in place of a raw JD */}
          <div className="flex flex-col gap-9 min-w-0">
            <AnalysisCard matchAnalysisJson={app.matchAnalysis} />
            <WhyWorkHereBlock appId={app.id} initialAnswer={app.whyWorkHere} />
            <CompanySummaryBlock appId={app.id} initialSummary={app.companySummary} />
            <CompanyEnrichment companyNewsJson={app.companyNews} glassdoorDataJson={app.glassdoorData} />
          </div>
        </div>

        {/* Modals */}
        {modal?.type === 'note' && (
          <NoteModal appId={app.id} onClose={() => setModal(null)} onSaved={closeAndReload} />
        )}
      </div>
    </div>
  );
}

function daysAgo(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function DaysInStage({ updatedAt }: { updatedAt: string }) {
  const days = daysAgo(updatedAt);
  if (days === null) return null;
  const label = days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
  return <span className="text-[13px] font-medium text-[var(--ed-ink-faint)] tabular-nums">{label} in stage</span>;
}

function CompanySummaryBlock({ appId, initialSummary }: { appId: string; initialSummary: string | null }) {
  const [summary, setSummary] = useState<string>(initialSummary || '');
  const generateMutation = useGenerateCompanySummary();
  const loading = generateMutation.isPending;

  function generate(): void {
    generateMutation.mutate(appId, {
      onSuccess: (res: { company_summary: string }) => {
        setSummary(res.company_summary);
      },
      onError: (e) => {
        alert('Failed to generate summary: ' + (e as Error).message);
      },
    });
  }

  return (
    <section className="mb-9">
      <SectionHead
        title="Company Summary"
        action={
          <button type="button" className={ED_GHOST} onClick={generate} disabled={loading}>
            {loading ? 'Generating...' : summary ? 'Regenerate' : 'Generate'}
          </button>
        }
      />
      {summary ? (
        <p dir="rtl" className="text-[16px] leading-[1.8] text-[var(--ed-ink)] whitespace-pre-wrap text-right m-0">
          {summary}
        </p>
      ) : (
        <p className="ed-display text-[16px] text-[var(--ed-ink-faint)] italic m-0">Click Generate to create an AI summary of this company.</p>
      )}
    </section>
  );
}

function WhyWorkHereBlock({ appId, initialAnswer }: { appId: string; initialAnswer: string | null }) {
  const [answer, setAnswer] = useState<string>(initialAnswer || '');
  const [copied, setCopied] = useState(false);
  const generateMutation = useGenerateWhyWorkHere();
  const loading = generateMutation.isPending;

  function generate(): void {
    generateMutation.mutate(appId, {
      onSuccess: (res: { why_work_here: string }) => {
        setAnswer(res.why_work_here);
      },
      onError: (e) => {
        alert('Failed to generate answer: ' + (e as Error).message);
      },
    });
  }

  async function copyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <section className="mb-9">
      <SectionHead
        title="Why Work Here?"
        action={
          <button type="button" className={ED_GHOST} onClick={generate} disabled={loading}>
            {loading ? 'Generating...' : answer ? 'Regenerate' : 'Generate'}
          </button>
        }
      />
      {answer ? (
        <div className="relative">
          <p dir="rtl" className="text-[16px] leading-[1.8] text-[var(--ed-ink)] whitespace-pre-wrap text-right m-0 pl-16">
            {answer}
          </p>
          <button
            type="button"
            onClick={copyToClipboard}
            className="absolute top-0 left-0 py-[0.3rem] px-[0.6rem] rounded-full text-[13px] font-medium uppercase tracking-[0.04em] border border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink-faint)] cursor-pointer transition-all hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <p className="ed-display text-[16px] text-[var(--ed-ink-faint)] italic m-0">
          Generate a personalized answer to "Why do you want to work here?" based on this role and your profile.
        </p>
      )}
    </section>
  );
}

interface GlassdoorSubRatings {
  workLifeBalance?: number;
  cultureAndValues?: number;
  careerOpportunities?: number;
  seniorManagement?: number;
  compensationAndBenefits?: number;
}

interface GlassdoorData {
  rating?: number | null;
  reviewCount?: number;
  url?: string;
  subRatings?: GlassdoorSubRatings;
  recommendPercent?: number;
  snippets?: string[];
}

const SUB_RATING_LABELS: [keyof GlassdoorSubRatings, string][] = [
  ['workLifeBalance', 'Work-life'],
  ['cultureAndValues', 'Culture'],
  ['careerOpportunities', 'Career'],
  ['seniorManagement', 'Management'],
  ['compensationAndBenefits', 'Compensation'],
];

interface NewsItem {
  title: string;
  source?: string;
}

function CompanyEnrichment({ companyNewsJson, glassdoorDataJson }: { companyNewsJson: string | null; glassdoorDataJson: string | null }) {
  let news: NewsItem[] | null = null;
  let glassdoor: GlassdoorData | null = null;
  try { if (companyNewsJson) news = JSON.parse(companyNewsJson); } catch { /* malformed */ }
  try { if (glassdoorDataJson) glassdoor = JSON.parse(glassdoorDataJson); } catch { /* malformed */ }

  if (!news?.length && !glassdoor) return null;

  return (
    <section className="mb-9">
      <SectionHead title="Company Info" />

      {glassdoor && (
        <div className="mb-3">
          <div className="flex items-center gap-[0.45rem]">
            {glassdoor.rating != null && (
              <span className="text-[16px] font-medium text-[var(--ed-ink)] tabular-nums">
                Glassdoor {glassdoor.rating.toFixed(1)} / 5
              </span>
            )}
            {glassdoor.reviewCount && <span className="text-[13px] text-[var(--ed-ink-faint)] tabular-nums">({glassdoor.reviewCount.toLocaleString()} reviews)</span>}
            {glassdoor.recommendPercent != null && <span className="text-[13px] text-[var(--ed-ink-soft)] tabular-nums">· {glassdoor.recommendPercent}% recommend</span>}
            {glassdoor.url && <a href={glassdoor.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[var(--ed-accent)] hover:opacity-75">View</a>}
          </div>
          {glassdoor.subRatings && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--ed-ink-faint)] mt-1">
              {SUB_RATING_LABELS.map(([key, label]) => {
                const v = glassdoor?.subRatings?.[key];
                return v != null ? (
                  <span key={key}>{label} <span className="font-medium tabular-nums text-[var(--ed-ink-soft)]">{v.toFixed(1)}</span></span>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}

      {news && news.length > 0 && (
        <div>
          <h4 className="text-[13px] font-medium uppercase tracking-[0.1em] text-[var(--ed-ink-faint)] mb-2 tabular-nums">Recent News ({news.length})</h4>
          <ul className="pl-4 list-disc marker:text-[var(--ed-rule)]">
            {news.map((n, i) => (
              <li key={i} className="text-[16px] text-[var(--ed-ink-soft)] leading-[1.65] mb-[0.2rem]">
                {n.title}{n.source && <span className="text-[var(--ed-ink-faint)]"> — {n.source}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ApplicationDetailLoadingSkeleton() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-500 pb-4 relative" role="status" aria-live="polite" aria-label="Loading application details">
      <Skeleton className="w-[120px] h-[14px] rounded mb-5" aria-hidden="true" />

      {/* Hero card */}
      <div
        className="bg-card border border-border rounded-lg p-6 mb-4 flex flex-col gap-[0.85rem] relative overflow-hidden pb-5 animate-in fade-in slide-in-from-bottom-2 duration-300"
        aria-hidden="true"
      >
        <div className="flex justify-between items-start gap-6 flex-wrap">
          <div className="flex-1 min-w-0 flex flex-col gap-[0.55rem]">
            <Skeleton className="w-[62%] h-[22px] rounded" />
            <Skeleton className="w-[40%] h-[14px] rounded" />
            <Skeleton className="w-[86px] h-[22px] rounded-sm" />
          </div>
          <div className="flex flex-col items-center gap-[0.4rem] shrink-0">
            <Skeleton className="w-[64px] h-[42px] rounded-sm" />
            <Skeleton className="w-[72px] h-[12px] rounded" />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap mt-[0.4rem]">
          <Skeleton className="w-[96px] h-[32px] rounded-lg" />
          <Skeleton className="w-[96px] h-[32px] rounded-lg" />
          <Skeleton className="w-[96px] h-[32px] rounded-lg" />
          <Skeleton className="w-[64px] h-[32px] rounded-lg" />
        </div>
        <div className="mt-[1.1rem] h-px" style={{ background: 'linear-gradient(to left, transparent, rgba(163,163,163,0.18) 50%, transparent)' }} />
      </div>

      {/* Analysis card skeleton */}
      <div
        className="bg-card border border-border rounded-lg p-6 mb-4 flex flex-col gap-[0.85rem] relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: '70ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <span className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] py-[0.18rem] px-2 border border-border rounded bg-muted/50 tabular-nums">A</span>
          <Skeleton className="flex-1 max-w-[200px] h-[14px] rounded" />
        </div>
        <div className="flex flex-wrap gap-[0.4rem] mb-1">
          <Skeleton className="inline-block w-[96px] h-[22px] rounded-full" />
          <Skeleton className="inline-block w-[62px] h-[22px] rounded-full" />
          <Skeleton className="inline-block w-[96px] h-[22px] rounded-full" />
          <Skeleton className="inline-block w-[62px] h-[22px] rounded-full" />
        </div>
        <Skeleton className="w-full h-[12px] rounded" />
        <Skeleton className="w-[70%] h-[12px] rounded" />
        <Skeleton className="w-[45%] h-[12px] rounded" />
      </div>

      {/* Timeline card skeleton */}
      <div
        className="bg-card border border-border rounded-lg p-6 mb-4 flex flex-col gap-[0.85rem] relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: '140ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <span className="font-serif text-[0.78rem] font-bold text-foreground tracking-[0.14em] py-[0.18rem] px-2 border border-border rounded bg-muted/50 tabular-nums">§</span>
          <Skeleton className="flex-1 max-w-[200px] h-[14px] rounded" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 py-3 border-b border-border items-start last:border-b-0">
            <Skeleton className="w-[34px] h-[34px] rounded-[9px] shrink-0" />
            <div className="flex-1 flex flex-col gap-[0.4rem]">
              <Skeleton className="w-[70%] h-[12px] rounded" />
              <Skeleton className="w-[45%] h-[12px] rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* Cycling subtitle */}
      <div className="mt-9 pt-5 border-t border-dashed border-border flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-muted-foreground italic tracking-[-0.005em] relative">
        <div className="absolute top-[-1px] left-0 w-[36px] h-px bg-primary opacity-50" />
        <span className="font-serif text-[1.15rem] text-primary opacity-75 not-italic" aria-hidden="true">§</span>
        <span aria-hidden="true">Loading...</span>
        <span className="sr-only">Loading application details</span>
      </div>
    </div>
  );
}
