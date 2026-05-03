import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';
import { formatDate, formatDateTime } from '../../utils/format';
import StatusBadge from '../../components/StatusBadge';
import StatCard from '../../components/StatCard';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [apps, s, u] = await Promise.all([
          api('/applications'),
          api('/stats'),
          api('/interviews/upcoming'),
        ]);
        setRecent(apps.slice(0, 5));
        setStats(s);
        setUpcoming(u);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <DashboardLoadingSkeleton />;
  if (error) return <Card className="p-6 mb-4"><p className="text-muted-foreground">Error loading data: {error}</p></Card>;

  return (
    <>
      {stats && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-2 gap-3 mb-6">
          <StatCard value={stats.total} label="Total Applications" />
          <StatCard value={stats.inProgress} label="In Progress" />
          <StatCard value={stats.avgScore || '-'} label="Average Score" />
          <StatCard value={`${stats.responseRate}%`} label="Response Rate" />
        </div>
      )}

      <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
        <h3 className="text-[0.95rem] font-semibold text-foreground mb-3 pb-[0.6rem] border-b border-border">Upcoming Interviews</h3>
        {upcoming.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground text-[0.88rem]">No upcoming interviews</p>
        ) : (
          upcoming.map((u, i) => (
            <div key={i} className="bg-muted border border-border rounded p-[1rem_1.25rem] mb-3 transition-all hover:border-border hover:shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-foreground text-[0.88rem]">{u.interview.type} - {u.company || ''}</span>
                <span className="text-[0.78rem] text-muted-foreground">{formatDateTime(u.interview.scheduledAt)}</span>
              </div>
              <div className="text-[0.84rem] text-foreground leading-[1.6] text-muted-foreground">{u.jobTitle || ''} {u.interview.interviewer ? `| ${u.interview.interviewer}` : ''}</div>
            </div>
          ))
        )}
      </Card>

      <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md mt-4">
        <h3 className="text-[0.95rem] font-semibold text-foreground mb-3 pb-[0.6rem] border-b border-border">Recent Activity</h3>
        {recent.length === 0 ? (
          <p className="text-center py-12 text-muted-foreground text-[0.88rem]">No recent activity</p>
        ) : (
          recent.map((a) => (
            <div key={a.id} className="group flex gap-4 py-[0.85rem] border-b border-border items-start transition-colors last:border-b-0 cursor-pointer" onClick={() => navigate(`/tracker/${a.id}`)}>
              <div className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center text-[0.8rem] shrink-0 transition-transform group-hover:scale-[1.08] bg-blue-bg text-blue">&#x1F4CB;</div>
              <div className="flex-1">
                <div className="text-[0.84rem] mt-[0.15rem]"><strong>{a.jobTitle}</strong> - {a.company} <StatusBadge status={a.status} /></div>
                <div className="text-[0.73rem] text-muted-foreground">{formatDate(a.createdAt)}</div>
              </div>
            </div>
          ))
        )}
      </Card>
    </>
  );
}

const DASHBOARD_HERO_LETTERS = ['D', 'a', 's', 'h', 'b', 'o', 'a', 'r', 'd'];

function DashboardLoadingSkeleton() {
  return (
    <div className="animate-page-in pb-4 relative" role="status" aria-live="polite" aria-label="Loading dashboard">
      {/* Hero */}
      <header className="mb-8 pb-5" aria-hidden="true">
        <span className="inline-block font-mono text-[0.7rem] tracking-[0.22em] uppercase text-primary mb-[0.55rem] opacity-85">Overview · 2026</span>
        <h2 className="font-serif text-[clamp(1.6rem,3vw,2rem)] font-bold text-foreground leading-[1.1] m-0 mb-[0.8rem] tracking-[-0.01em] flex items-baseline">
          {DASHBOARD_HERO_LETTERS.map((ch, i) => (
            <span
              key={i}
              className="inline-block opacity-0 translate-y-[6px]"
              style={{
                animation: 'letterInk 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards',
                animationDelay: `${i * 60 + 80}ms`,
              }}
            >{ch}</span>
          ))}
        </h2>
        <div className="mt-[1.1rem] h-px relative overflow-hidden" style={{ background: 'linear-gradient(to left, transparent, hsl(var(--border) / 0.4) 50%, transparent)' }}>
          <span className="absolute top-[-1px] bottom-[-1px] w-[28%] animate-track-sweep" style={{ background: 'linear-gradient(90deg, transparent 0%, hsl(var(--muted-foreground) / 0.55) 50%, transparent 100%)', filter: 'blur(0.5px)', boxShadow: '0 0 6px hsl(var(--muted-foreground) / 0.3)' }} />
        </div>
      </header>

      {/* Summary grid skeleton */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-sm:grid-cols-2 gap-3 mb-7" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <Card
            key={i}
            className="py-[1.6rem] px-5 text-center relative overflow-hidden"
            style={{
              animation: 'cardRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both',
              animationDelay: `${i * 70 + 220}ms`,
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-ring opacity-30" />
            <span className="skeleton block w-[48px] h-[34px] rounded mx-auto mb-[0.55rem]" />
            <span className="skeleton block w-[82px] h-[10px] rounded-[3px] mx-auto" />
          </Card>
        ))}
      </div>

      {/* Section 01 */}
      <Card
        className="p-6 mb-4 flex flex-col gap-[0.85rem] relative overflow-hidden"
        style={{ animation: 'cardRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both', animationDelay: '580ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <Badge variant="outline" className="font-serif text-[0.78rem] font-bold tracking-[0.14em] tabular-nums">01</Badge>
          <span className="skeleton flex-1 max-w-[200px] h-[14px] rounded" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="py-[0.85rem] px-4 border border-border rounded bg-muted flex flex-col gap-2">
            <div className="flex justify-between items-center gap-4">
              <span className="skeleton w-[45%] h-[14px] rounded" />
              <span className="skeleton w-[90px] h-[12px] rounded" />
            </div>
            <span className="skeleton w-[70%] h-[12px] rounded" />
          </div>
        ))}
      </Card>

      {/* Section 02 */}
      <Card
        className="p-6 mb-4 flex flex-col gap-[0.85rem] relative overflow-hidden"
        style={{ animation: 'cardRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both', animationDelay: '650ms' }}
        aria-hidden="true"
      >
        <div className="flex items-baseline gap-3 pb-[0.7rem] mb-1 border-b border-border">
          <Badge variant="outline" className="font-serif text-[0.78rem] font-bold tracking-[0.14em] tabular-nums">02</Badge>
          <span className="skeleton flex-1 max-w-[200px] h-[14px] rounded" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 py-3 border-b border-border items-start last:border-b-0">
            <span className="skeleton w-[34px] h-[34px] rounded-[9px] shrink-0" />
            <div className="flex-1 flex flex-col gap-[0.4rem]">
              <span className="skeleton w-[70%] h-[12px] rounded" />
              <span className="skeleton w-[45%] h-[12px] rounded" />
            </div>
          </div>
        ))}
      </Card>

      {/* Cycling subtitle */}
      <div className="mt-9 pt-5 border-t border-dashed border-border flex items-center gap-[0.65rem] font-serif text-[0.92rem] text-muted-foreground italic tracking-[-0.005em] relative">
        <div className="absolute top-[-1px] left-0 w-[36px] h-px bg-primary opacity-50" />
        <span className="font-serif text-[1.15rem] text-primary opacity-75 not-italic" aria-hidden="true">§</span>
        <span className="relative inline-block h-[1.4em] min-w-[22ch]" aria-hidden="true">
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] whitespace-nowrap" style={{ animation: 'cycleFade 6s cubic-bezier(0.22, 1, 0.36, 1) infinite', animationDelay: '0s' }}>Fetching active applications</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] whitespace-nowrap" style={{ animation: 'cycleFade 6s cubic-bezier(0.22, 1, 0.36, 1) infinite', animationDelay: '2s' }}>Summarizing statistics</span>
          <span className="absolute inset-0 left-0 opacity-0 translate-y-[6px] whitespace-nowrap" style={{ animation: 'cycleFade 6s cubic-bezier(0.22, 1, 0.36, 1) infinite', animationDelay: '4s' }}>Mapping upcoming interviews</span>
        </span>
        <span className="sr-only">Loading dashboard</span>
      </div>
    </div>
  );
}
