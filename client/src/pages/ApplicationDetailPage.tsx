import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { useQueryClient } from '@tanstack/react-query';
import { useApplicationDetail } from '../lib/queries';
import { useDeleteApplication, useUpdateSalary, useGenerateCompanySummary, useGenerateWhyWorkHere } from '../lib/mutations';
import { scoreColor } from '../lib/format';
import { StatusBadge, StatusModal } from '../components/Status';
import CollapsibleSection from '../components/CollapsibleSection';
import { SnapshotsCard } from '../components/Snapshots';
import AnalysisCard from '../components/AnalysisCard';
import Timeline from '../components/Timeline';
import { InterviewList, InterviewModal } from '../components/Interviews';
import { NoteList, NoteModal } from '../components/Notes';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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
    <div className="min-h-[calc(100vh-56px)] bg-background animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="max-w-[1100px] mx-auto px-6 pb-8">
        <ApplicationDetailLoadingSkeleton />
      </div>
    </div>
  );

  const data = detailQuery.data as ApplicationDetailData | undefined;
  if (!data) return (
    <div className="min-h-[calc(100vh-56px)] bg-background animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="max-w-[1100px] mx-auto px-6 pb-8">
        <ApplicationDetailLoadingSkeleton />
      </div>
    </div>
  );

  const { application: app, interviews, notes, statusUpdates } = data;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-background animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="max-w-[1100px] mx-auto px-6 pb-8">
        <Link to="/tracker" state={{ tab: 'list' }} className="text-primary cursor-pointer text-[0.88rem] mb-5 inline-flex items-center gap-[0.4rem] font-medium transition-all hover:text-primary/80 hover:gap-[0.6rem]">&larr; Back to List</Link>

        {/* Header */}
        <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
          <div className="flex justify-between items-start mb-6 flex-wrap gap-4">
            <div>
              <h2 className="text-foreground mb-1 text-[1.3rem] font-bold tracking-[-0.01em]">{app.jobTitle}</h2>
              <div className="text-muted-foreground text-[0.95rem]">{app.company}</div>
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <StatusBadge status={app.status} />
                <DaysInStage updatedAt={app.updatedAt} />
              </div>
            </div>
            <div className="text-center">
              <div className="font-sans text-[2.2rem] font-bold tracking-[-0.02em]" style={{ color: scoreColor(app.matchScore) }}>{app.matchScore ?? '-'}</div>
              <div className="text-muted-foreground text-[0.84rem]">{app.matchVerdict || ''}</div>
            </div>
          </div>

          <NextAction status={app.status} updatedAt={app.updatedAt} interviews={interviews} />

          <SalaryField appId={app.id} initialValue={app.salary} />

          <div className="flex gap-2 flex-wrap mt-4">
            {app.jobUrl && (
              <Button variant="outline" asChild>
                <a href={app.jobUrl} target="_blank" rel="noopener noreferrer">View Job</a>
              </Button>
            )}
            <Button onClick={() => setModal({ type: 'status' })}>Update Status</Button>
            <Button variant="outline" onClick={() => setModal({ type: 'interview' })}>Add Interview</Button>
            <Button variant="outline" onClick={() => setModal({ type: 'note' })}>Add Note</Button>
            <Button variant="destructive" onClick={deleteApp}>Delete</Button>
          </div>
        </Card>

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
        <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
          <h3 className="text-[0.95rem] font-semibold text-foreground mb-3 pb-[0.6rem] border-b border-border">Timeline</h3>
          <Timeline statusUpdates={statusUpdates} interviews={interviews} notes={notes} />
        </Card>

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
  const color = days >= 14 ? '#ef4444' : days >= 7 ? '#d97706' : 'var(--muted-foreground)';
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
    <div className="mb-3 py-[0.45rem] px-3 rounded-md bg-primary/5 border border-primary/15 text-[0.82rem] text-primary font-medium">
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
      <label className="text-[0.82rem] text-muted-foreground font-medium shrink-0">Salary</label>
      <input
        className="max-w-[200px] h-8 text-[0.84rem] px-2 rounded-md border border-border bg-background text-foreground"
        placeholder="e.g. 25-30K/mo"
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && save()}
      />
      {saved && <span className="text-[0.75rem] text-green-600 font-medium">Saved</span>}
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
    <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
      <div className="flex items-center justify-between mb-3 pb-[0.6rem] border-b border-border">
        <h3 className="text-[0.95rem] font-semibold text-foreground">Company Summary</h3>
        <Button variant="outline" size="sm" onClick={generate} disabled={loading}>
          {loading ? 'Generating...' : summary ? 'Regenerate' : 'Generate'}
        </Button>
      </div>
      {summary ? (
        <p dir="rtl" className="text-[0.88rem] leading-[1.75] text-foreground whitespace-pre-wrap text-right m-0">
          {summary}
        </p>
      ) : (
        <p className="text-[0.82rem] text-muted-foreground italic m-0">Click Generate to create an AI summary of this company.</p>
      )}
    </Card>
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
    <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
      <div className="flex items-center justify-between mb-3 pb-[0.6rem] border-b border-border">
        <h3 className="text-[0.95rem] font-semibold text-foreground">למה לעבוד כאן?</h3>
        <Button variant="outline" size="sm" onClick={generate} disabled={loading}>
          {loading ? 'Generating...' : answer ? 'Regenerate' : 'Generate'}
        </Button>
      </div>
      {answer ? (
        <div className="relative">
          <p dir="rtl" className="text-[0.88rem] leading-[1.75] text-foreground whitespace-pre-wrap text-right m-0 pl-16">
            {answer}
          </p>
          <button
            type="button"
            onClick={copyToClipboard}
            className="absolute top-0 left-0 py-[0.3rem] px-[0.6rem] rounded-md text-[0.72rem] font-medium border border-border bg-card text-muted-foreground cursor-pointer transition-all hover:border-foreground/30 hover:text-foreground"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <p className="text-[0.82rem] text-muted-foreground italic m-0">
          Generate a personalized answer to "Why do you want to work here?" based on this role and your profile.
        </p>
      )}
    </Card>
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
    <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
      <h3 className="text-[0.95rem] font-semibold text-foreground mb-3 pb-[0.6rem] border-b border-border">Company Info</h3>

      {glassdoor && (
        <div className="flex items-center gap-[0.45rem] mb-3">
          <span className="text-[0.82rem] font-medium" style={{
            color: glassdoor.rating >= 4.0 ? '#059669'
                 : glassdoor.rating >= 3.0 ? '#d97706'
                 : '#ef4444'
          }}>
            Glassdoor {glassdoor.rating.toFixed(1)} / 5
          </span>
          {glassdoor.reviewCount && <span className="text-[0.75rem] text-muted-foreground">({glassdoor.reviewCount.toLocaleString()} reviews)</span>}
          {glassdoor.url && <a href={glassdoor.url} target="_blank" rel="noopener noreferrer" className="text-[0.75rem] text-primary hover:opacity-75">View</a>}
        </div>
      )}

      {news && news.length > 0 && (
        <div>
          <h4 className="text-[0.82rem] font-medium text-muted-foreground mb-1">Recent News ({news.length})</h4>
          <ul className="pl-4 list-disc">
            {news.map((n, i) => (
              <li key={i} className="text-[0.78rem] text-muted-foreground leading-[1.6] mb-[0.2rem]">
                {n.title}{n.source && <span className="text-muted-foreground/60"> — {n.source}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
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
