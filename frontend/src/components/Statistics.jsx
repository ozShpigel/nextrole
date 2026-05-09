import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { STATUS_LABELS } from '../constants/tracker';
import { StatCard } from './Stats';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const BAR_COLORS = {
  Analyzing: '#d97706',
  DecidedToApply: '#a855f7',
  Applied: '#3b82f6',
  PhoneScreen: '#059669',
  TechnicalInterview: '#059669',
  FinalRound: '#059669',
  OfferReceived: '#6ee7b7',
  Accepted: '#059669',
  Rejected: '#ef4444',
  Withdrawn: '#9ca3af',
};

export default function Statistics() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api('/stats').then(setStats).catch(console.error);
  }, []);

  if (!stats) return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-2 gap-3 mb-6">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="py-6 px-5 text-center">
          <Skeleton className="w-12 h-8 rounded mx-auto mb-2" />
          <Skeleton className="w-20 h-3 rounded mx-auto" />
        </Card>
      ))}
    </div>
  );

  const breakdown = stats.statusBreakdown || {};
  const max = Math.max(...Object.values(breakdown), 1);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-2 gap-3 mb-6">
        <StatCard value={stats.total} label="Total Applications" />
        <StatCard value={stats.applied} label="Applied" />
        <StatCard value={stats.avgScore || '-'} label="Average Score" />
        <StatCard value={`${stats.responseRate}%`} label="Response Rate" />
      </div>

      <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md mt-4">
        <h3 className="text-[0.95rem] font-semibold text-foreground mb-3 pb-[0.6rem] border-b border-border">Status Breakdown</h3>
        <div className="mt-4">
          {Object.entries(STATUS_LABELS).map(([key, label]) => {
            const count = breakdown[key] || 0;
            const pct = (count / max * 100).toFixed(0);
            const color = BAR_COLORS[key] || 'var(--muted-foreground)';
            return (
              <div key={key} className="flex items-center gap-3 mb-[0.65rem]">
                <span className="min-w-[130px] text-[0.82rem] text-muted-foreground">{label}</span>
                <div className="flex-1 h-[22px] bg-muted rounded-sm overflow-hidden border border-border">
                  <div className="h-full rounded-[5px] transition-all duration-[800ms] flex items-center justify-center text-[0.72rem] font-semibold" style={{ width: `${pct}%`, background: color }}>
                    {count > 0 ? count : ''}
                  </div>
                </div>
                <span className="min-w-[30px] text-left text-[0.82rem] text-muted-foreground">{count}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
