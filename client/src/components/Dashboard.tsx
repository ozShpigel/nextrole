import { useNavigate } from 'react-router-dom';
import { useApplications, useStats, useUpcomingInterviews } from '../lib/queries';
import { formatDate, formatDateTime } from '../lib/format';
import { StatusBadge } from './Status';
import { StatCard } from './Stats';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface UpcomingInterview {
  interview: {
    type: string;
    scheduledAt: string;
    interviewer?: string;
  };
  company?: string;
  jobTitle?: string;
}

interface RecentApp {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  createdAt: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const applicationsQuery = useApplications();
  const statsQuery = useStats();
  const upcomingQuery = useUpcomingInterviews();

  const loading = applicationsQuery.isLoading || statsQuery.isLoading || upcomingQuery.isLoading;
  const error = applicationsQuery.error?.message || statsQuery.error?.message || upcomingQuery.error?.message || null;

  const stats = statsQuery.data ?? null;
  const upcoming: UpcomingInterview[] = upcomingQuery.data ?? [];
  const recent: RecentApp[] = applicationsQuery.data?.slice(0, 5) ?? [];

  if (loading) return <DashboardLoadingSkeleton />;
  if (error) return <div className="border border-[var(--ed-no)]/30 bg-[var(--ed-no)]/10 p-6 mb-4"><p className="text-[var(--ed-no)]">Error loading data: {error}</p></div>;

  return (
    <>
      {stats && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-2 gap-3 mb-9">
          <StatCard value={stats.total} label="Total Applications" />
          <StatCard value={stats.inProgress} label="In Progress" />
          <StatCard value={stats.avgScore || '-'} label="Average Score" />
          <StatCard value={`${stats.responseRate}%`} label="Response Rate" />
        </div>
      )}

      <section className="mb-9">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="ed-display italic font-semibold text-[1.4rem] tracking-[-0.01em] text-[var(--ed-ink)]">Upcoming Interviews</span>
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">Section 01</span>
        </div>
        <div className="border-t border-[var(--ed-rule-strong)]" />
        {upcoming.length === 0 ? (
          <p className="text-center py-12 text-[var(--ed-ink-faint)] text-[0.88rem]">No upcoming interviews</p>
        ) : (
          upcoming.map((u, i) => (
            <div key={i} className="border-t border-[var(--ed-rule)] py-[0.95rem] first:border-t-0">
              <div className="flex justify-between items-baseline gap-3 mb-1">
                <span className="ed-display font-semibold text-[var(--ed-ink)] text-[1.02rem] tracking-[-0.005em]">{u.interview.type} — {u.company || ''}</span>
                <span className="text-[0.74rem] text-[var(--ed-ink-faint)] tabular-nums shrink-0">{formatDateTime(u.interview.scheduledAt)}</span>
              </div>
              <div className="text-[0.84rem] text-[var(--ed-ink-soft)] leading-[1.6]">{u.jobTitle || ''} {u.interview.interviewer ? `· ${u.interview.interviewer}` : ''}</div>
            </div>
          ))
        )}
      </section>

      <section className="mb-4">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="ed-display italic font-semibold text-[1.4rem] tracking-[-0.01em] text-[var(--ed-ink)]">Recent Activity</span>
          <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-[var(--ed-ink-faint)]">Section 02</span>
        </div>
        <div className="border-t border-[var(--ed-rule-strong)]" />
        {recent.length === 0 ? (
          <p className="text-center py-12 text-[var(--ed-ink-faint)] text-[0.88rem]">No recent activity</p>
        ) : (
          recent.map((a, i) => (
            <div key={a.id} className="group flex items-baseline gap-4 py-[0.9rem] border-t border-[var(--ed-rule)] transition-colors hover:bg-[var(--ed-panel)]/60 cursor-pointer first:border-t-0" onClick={() => navigate(`/tracker/${a.id}`)}>
              <span className="ed-display text-[1.05rem] leading-none tabular-nums text-[var(--ed-ink-faint)] shrink-0 w-7">{String(i + 1).padStart(2, '0')}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[0.9rem] flex items-center gap-2 flex-wrap">
                  <span className="ed-display font-semibold text-[var(--ed-ink)] transition-colors group-hover:text-[var(--ed-accent-deep)]">{a.jobTitle}</span>
                  <span className="text-[var(--ed-ink-faint)]">— {a.company}</span>
                  <StatusBadge status={a.status} />
                </div>
                <div className="text-[0.72rem] text-[var(--ed-ink-faint)] mt-[0.15rem] tabular-nums">{formatDate(a.createdAt)}</div>
              </div>
            </div>
          ))
        )}
      </section>
    </>
  );
}

function DashboardLoadingSkeleton() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-500 pb-4 relative" role="status" aria-live="polite" aria-label="Loading dashboard">
      {/* Hero */}
      <header className="mb-8 pb-5" aria-hidden="true">
        <span className="inline-block font-mono text-[0.7rem] tracking-[0.22em] uppercase text-primary mb-[0.55rem] opacity-85">Overview · 2026</span>
        <h2 className="font-serif text-[clamp(1.6rem,3vw,2rem)] font-bold text-foreground leading-[1.1] m-0 mb-[0.8rem] tracking-[-0.01em] animate-in fade-in duration-300">
          Dashboard
        </h2>
        <div className="mt-[1.1rem] h-px" style={{ background: 'linear-gradient(to left, transparent, hsl(var(--border) / 0.4) 50%, transparent)' }} />
      </header>

      {/* Summary grid skeleton */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-sm:grid-cols-2 gap-3 mb-7" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Card
            key={i}
            className="py-[1.6rem] px-5 text-center relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
            style={{ animationDelay: `${i * 70 + 220}ms` }}
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-ring opacity-30" />
            <Skeleton className="block w-[48px] h-[34px] rounded mx-auto mb-[0.55rem]" />
            <Skeleton className="block w-[82px] h-[10px] rounded-[3px] mx-auto" />
          </Card>
        ))}
      </div>

      {/* Section 01 */}
      <Card
        className="p-6 mb-4 flex flex-col gap-[0.85rem] relative overflow-hidden"
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <Badge variant="outline" className="font-serif text-[0.78rem] font-bold tracking-[0.14em] tabular-nums">01</Badge>
          <Skeleton className="flex-1 max-w-[200px] h-[14px] rounded" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="py-[0.85rem] px-4 border border-border rounded bg-muted flex flex-col gap-2">
            <div className="flex justify-between items-center gap-4">
              <Skeleton className="w-[45%] h-[14px] rounded" />
              <Skeleton className="w-[90px] h-[12px] rounded" />
            </div>
            <Skeleton className="w-[70%] h-[12px] rounded" />
          </div>
        ))}
      </Card>

      {/* Section 02 */}
      <Card
        className="p-6 mb-4 flex flex-col gap-[0.85rem] relative overflow-hidden"
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <Badge variant="outline" className="font-serif text-[0.78rem] font-bold tracking-[0.14em] tabular-nums">02</Badge>
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
      </Card>

      {/* Cycling subtitle */}
      <div className="mt-9 pt-5 border-t border-dashed border-border flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-muted-foreground italic tracking-[-0.005em] relative">
        <div className="absolute top-[-1px] left-0 w-[36px] h-px bg-primary opacity-50" />
        <span className="font-serif text-[1.15rem] text-primary opacity-75 not-italic" aria-hidden="true">§</span>
        <span aria-hidden="true">Loading...</span>
        <span className="sr-only">Loading dashboard</span>
      </div>
    </div>
  );
}
