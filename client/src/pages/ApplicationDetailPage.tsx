import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { useQueryClient } from '@tanstack/react-query';
import { useApplicationDetail } from '../lib/queries';
import { useDeleteApplication, useUpdateSalary, useGenerateCompanySummary, useGenerateWhyWorkHere } from '../lib/mutations';
import { StatusBadge, StatusModal } from '../components/Status';
import CollapsibleSection from '../components/CollapsibleSection';
import { SnapshotsCard } from '../components/Snapshots';
import AnalysisCard from '../components/AnalysisCard';
import Timeline from '../components/Timeline';
import { InterviewList, InterviewModal } from '../components/Interviews';
import { NoteList, NoteModal } from '../components/Notes';
import { Skeleton } from '@/components/ui/skeleton';

// Editorial score tint (var(--ed-*), valid only inside the .editorial scope)
function edScoreColor(score: number | null | undefined): string {
  if (score == null) return 'var(--ed-ink-faint)';
  if (score >= 60) return 'var(--ed-yes)';
  if (score >= 40) return 'var(--ed-gold)';
  return 'var(--ed-no)';
}

// Shared editorial button styles
const ED_BTN = 'rounded-none border px-3.5 py-[0.5rem] text-[0.68rem] font-semibold uppercase tracking-[0.08em] transition-all disabled:opacity-50 disabled:pointer-events-none';
const ED_GHOST = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-ink-soft)] hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]`;
const ED_PRIMARY = `${ED_BTN} border-[var(--ed-accent)] bg-[var(--ed-accent)] text-[var(--ed-paper)] hover:bg-[var(--ed-accent-deep)]`;
const ED_DANGER = `${ED_BTN} border-[var(--ed-rule)] text-[var(--ed-no)] hover:border-[var(--ed-no)] hover:bg-[var(--ed-no)]/10`;

// Editorial section heading (italic serif kicker + heavy rule)
function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="ed-display italic font-semibold text-[1.3rem] tracking-[-0.01em] text-[var(--ed-ink)]">{title}</span>
        {action}
      </div>
      <div className="border-t border-[var(--ed-rule-strong)] mb-4" />
    </>
  );
}

interface Interview {
  id: string;
  type: string;
  scheduledAt: string;
  interviewer?: string;
  topics?: string;
  notes?: string;
  feedback?: string;
  completed: boolean;
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
}

type ModalState =
  | { type: 'status' }
  | { type: 'interview' }
  | { type: 'editInterview'; data: Interview }
  | { type: 'note' }
  | null;

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalState>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const detailQuery = useApplicationDetail(id!);
  const deleteApplicationMutation = useDeleteApplication();

  function closeAndReload(): void {
    setModal(null);
    queryClient.invalidateQueries({ queryKey: ['applications', id] });
  }

  function refetch(): void {
    queryClient.invalidateQueries({ queryKey: ['applications', id] });
  }

  function deleteApp(): void {
    setShowDeleteConfirm(true);
  }

  function confirmDeleteApp(): void {
    setShowDeleteConfirm(false);
    deleteApplicationMutation.mutate(id!, {
      onSuccess: () => window.history.back(),
      onError: (e) => alert('Delete failed: ' + (e as Error).message),
    });
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

  const { application: app, interviews, notes, statusUpdates } = data;

  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="relative z-[1] max-w-[1100px] mx-auto px-8 pt-12 pb-16 max-[640px]:px-5">
        <Link to="/tracker" state={{ tab: 'list' }} className="text-[var(--ed-accent)] cursor-pointer text-[0.72rem] font-semibold uppercase tracking-[0.12em] mb-7 inline-flex items-center gap-[0.4rem] transition-all hover:-translate-x-[3px]">&larr; Back to List</Link>

        {/* Header masthead */}
        <header className="mb-9">
          <div className="flex justify-between items-start gap-6 flex-wrap pb-4 border-b border-[var(--ed-rule-strong)]">
            <div className="min-w-0">
              <div className="text-[0.7rem] font-bold uppercase tracking-[0.16em] text-[var(--ed-accent)] mb-2">{app.company}</div>
              <h2 className="ed-display font-black text-[clamp(1.9rem,4.5vw,3rem)] leading-[0.98] tracking-[-0.02em] text-[var(--ed-ink)]">{app.jobTitle}</h2>
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <StatusBadge status={app.status} />
                <DaysInStage updatedAt={app.updatedAt} />
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="ed-display font-black text-[3.4rem] leading-[0.8] tracking-[-0.03em] tabular-nums" style={{ color: edScoreColor(app.matchScore) }}>{app.matchScore ?? '-'}</div>
              <div className="text-[0.6rem] font-bold uppercase tracking-[0.18em] mt-2 text-[var(--ed-ink-faint)]">{app.matchVerdict || ''}</div>
            </div>
          </div>

          <div className="pt-4">
            <NextAction status={app.status} updatedAt={app.updatedAt} interviews={interviews} />

            <SalaryField appId={app.id} initialValue={app.salary} />

            <div className="flex gap-2 flex-wrap mt-4">
              {app.jobUrl && (
                <a href={app.jobUrl} target="_blank" rel="noopener noreferrer" className={ED_GHOST}>View Job</a>
              )}
              <button type="button" className={ED_PRIMARY} onClick={() => setModal({ type: 'status' })}>Update Status</button>
              <Link to={`/practice-interview?applicationId=${app.id}&company=${encodeURIComponent(app.company)}&jobTitle=${encodeURIComponent(app.jobTitle)}`} className={ED_GHOST}>
                Practice Interview
              </Link>
              <button type="button" className={ED_GHOST} onClick={() => setModal({ type: 'interview' })}>Add Interview</button>
              <button type="button" className={ED_GHOST} onClick={() => setModal({ type: 'note' })}>Add Note</button>
              <button type="button" className={ED_DANGER} onClick={deleteApp}>Delete</button>
            </div>
          </div>
        </header>

        {/* AI Analysis */}
        <AnalysisCard matchAnalysisJson={app.matchAnalysis} />

        {/* "Why work here?" interview answer */}
        <WhyWorkHereBlock appId={app.id} initialAnswer={app.whyWorkHere} />

        {/* Company summary & enrichment data */}
        <CompanySummaryBlock appId={app.id} initialSummary={app.companySummary} />
        <CompanyEnrichment companyNewsJson={app.companyNews} glassdoorDataJson={app.glassdoorData} />

        {/* Raw Claude call artifacts */}
        {(app.analystSnapshotInput || app.evaluatorSnapshotInput) && (
          <CollapsibleSection title="Raw Claude Calls" defaultOpen={false}>
            <SnapshotsCard snapshots={{
              analystInput:    app.analystSnapshotInput,
              analystOutput:   app.analystSnapshotOutput,
              evaluatorInput:  app.evaluatorSnapshotInput,
              evaluatorOutput: app.evaluatorSnapshotOutput,
            }} />
          </CollapsibleSection>
        )}

        {/* Timeline */}
        <section className="mb-9">
          <SectionHead title="Timeline" />
          <Timeline statusUpdates={statusUpdates} interviews={interviews} notes={notes} />
        </section>

        {/* Interviews */}
        <CollapsibleSection title={`Interviews (${interviews.length})`}>
          <InterviewList
            interviews={interviews}
            onEdit={(i: Interview) => setModal({ type: 'editInterview', data: i })}
            onRefresh={refetch}
          />
        </CollapsibleSection>

        {/* Notes */}
        <CollapsibleSection title={`Notes (${notes.length})`}>
          <NoteList notes={notes} onRefresh={refetch} />
        </CollapsibleSection>

        {/* Job Description */}
        {app.jobDescription && (
          <CollapsibleSection title="Job Description" defaultOpen={false}>
            <pre className="whitespace-pre-wrap font-sans text-[0.85rem] text-muted-foreground">{app.jobDescription}</pre>
          </CollapsibleSection>
        )}

        {/* Modals */}
        {modal?.type === 'status' && (
          <StatusModal appId={app.id} currentStatus={app.status} onClose={() => setModal(null)} onSaved={closeAndReload} />
        )}
        {modal?.type === 'interview' && (
          <InterviewModal appId={app.id} onClose={() => setModal(null)} onSaved={closeAndReload} />
        )}
        {modal?.type === 'editInterview' && (
          <InterviewModal appId={app.id} interview={modal.data} onClose={() => setModal(null)} onSaved={closeAndReload} />
        )}
        {modal?.type === 'note' && (
          <NoteModal appId={app.id} onClose={() => setModal(null)} onSaved={closeAndReload} />
        )}

        <ConfirmDialog
          open={showDeleteConfirm}
          description="Delete this application? All interviews and notes will also be deleted."
          onConfirm={confirmDeleteApp}
          onCancel={() => setShowDeleteConfirm(false)}
        />
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
  const color = days >= 14 ? 'var(--ed-no)' : days >= 7 ? 'var(--ed-gold)' : 'var(--ed-ink-faint)';
  return <span className="text-[0.78rem] font-medium" style={{ color }}>{label} in stage</span>;
}

function NextAction({ status, updatedAt, interviews }: { status: string; updatedAt: string; interviews: Interview[] }) {
  const days = daysAgo(updatedAt);
  let suggestion: string | null = null;

  if (status === 'Applied' && days !== null && days >= 7) {
    suggestion = 'Consider sending a follow-up email';
  } else if (status === 'DecidedToApply') {
    suggestion = 'Submit your application';
  } else if (status === 'PhoneScreen' || status === 'TechnicalInterview' || status === 'FinalRound') {
    const upcoming = interviews?.find((i) => new Date(i.scheduledAt) > new Date());
    suggestion = upcoming
      ? `Prepare for interview on ${new Date(upcoming.scheduledAt).toLocaleDateString()}`
      : 'Schedule your next interview';
  } else if (status === 'OfferReceived') {
    suggestion = 'Review offer terms and respond';
  }

  if (!suggestion) return null;
  return (
    <div className="mb-3 py-[0.5rem] px-3 bg-[var(--ed-accent)]/[0.07] border-l-2 border-[var(--ed-accent)] text-[0.84rem] text-[var(--ed-accent-deep)] font-medium">
      → {suggestion}
    </div>
  );
}

function SalaryField({ appId, initialValue }: { appId: string; initialValue: string | null }) {
  const [value, setValue] = useState<string>(initialValue || '');
  const [saved, setSaved] = useState<boolean>(false);
  const updateSalaryMutation = useUpdateSalary();

  function save(): void {
    updateSalaryMutation.mutate(
      { appId, salary: value || null },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
        onError: (e) => {
          alert('Failed to save salary: ' + (e as Error).message);
        },
      },
    );
  }

  return (
    <div className="flex items-center gap-2 mb-3">
      <label className="text-[0.64rem] uppercase tracking-[0.1em] text-[var(--ed-ink-faint)] font-semibold shrink-0">Salary</label>
      <input
        className="max-w-[200px] h-8 text-[0.84rem] px-2 rounded-none border border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink)] focus:outline-none focus:border-[var(--ed-ink)]"
        placeholder="e.g. 25-30K/mo"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && save()}
      />
      {saved && <span className="text-[0.7rem] uppercase tracking-[0.08em] text-[var(--ed-yes)] font-semibold">Saved</span>}
    </div>
  );
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
        <p dir="rtl" className="text-[0.9rem] leading-[1.8] text-[var(--ed-ink)] whitespace-pre-wrap text-right m-0">
          {summary}
        </p>
      ) : (
        <p className="text-[0.82rem] text-[var(--ed-ink-faint)] italic m-0">Click Generate to create an AI summary of this company.</p>
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
        title="למה לעבוד כאן?"
        action={
          <button type="button" className={ED_GHOST} onClick={generate} disabled={loading}>
            {loading ? 'Generating...' : answer ? 'Regenerate' : 'Generate'}
          </button>
        }
      />
      {answer ? (
        <div className="relative">
          <p dir="rtl" className="text-[0.9rem] leading-[1.8] text-[var(--ed-ink)] whitespace-pre-wrap text-right m-0 pl-16">
            {answer}
          </p>
          <button
            type="button"
            onClick={copyToClipboard}
            className="absolute top-0 left-0 py-[0.3rem] px-[0.6rem] rounded-none text-[0.66rem] font-semibold uppercase tracking-[0.06em] border border-[var(--ed-rule)] bg-transparent text-[var(--ed-ink-faint)] cursor-pointer transition-all hover:border-[var(--ed-ink)] hover:text-[var(--ed-ink)]"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <p className="text-[0.82rem] text-[var(--ed-ink-faint)] italic m-0">
          Generate a personalized answer to "Why do you want to work here?" based on this role and your profile.
        </p>
      )}
    </section>
  );
}

interface GlassdoorData {
  rating: number;
  reviewCount?: number;
  url?: string;
}

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
        <div className="flex items-center gap-[0.45rem] mb-3">
          <span className="text-[0.84rem] font-semibold" style={{
            color: glassdoor.rating >= 4.0 ? 'var(--ed-yes)'
                 : glassdoor.rating >= 3.0 ? 'var(--ed-gold)'
                 : 'var(--ed-no)'
          }}>
            Glassdoor {glassdoor.rating.toFixed(1)} / 5
          </span>
          {glassdoor.reviewCount && <span className="text-[0.75rem] text-[var(--ed-ink-faint)]">({glassdoor.reviewCount.toLocaleString()} reviews)</span>}
          {glassdoor.url && <a href={glassdoor.url} target="_blank" rel="noopener noreferrer" className="text-[0.75rem] text-[var(--ed-accent)] hover:opacity-75">View</a>}
        </div>
      )}

      {news && news.length > 0 && (
        <div>
          <h4 className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--ed-ink-faint)] mb-2">Recent News ({news.length})</h4>
          <ul className="pl-4 list-disc marker:text-[var(--ed-rule)]">
            {news.map((n, i) => (
              <li key={i} className="text-[0.8rem] text-[var(--ed-ink-soft)] leading-[1.65] mb-[0.2rem]">
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
        className="bg-card border border-border rounded-lg p-6 mb-4 shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden pb-5 animate-in fade-in slide-in-from-bottom-2 duration-300"
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
        className="bg-card border border-border rounded-lg p-6 mb-4 shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
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
        className="bg-card border border-border rounded-lg p-6 mb-4 shadow-sm flex flex-col gap-[0.85rem] relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
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
