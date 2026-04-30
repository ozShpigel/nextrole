import { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import { STATUS_LABELS } from '../../utils/constants';
import { Card } from '@/components/ui/card';

const BAR_COLORS = {
  Analyzing: 'var(--color-yellow)',
  DecidedToApply: 'var(--color-purple)',
  Applied: 'var(--color-blue)',
  PhoneScreen: 'var(--color-green)',
  TechnicalInterview: 'var(--color-green)',
  FinalRound: 'var(--color-green)',
  OfferReceived: '#6ee7b7',
  Accepted: 'var(--color-green)',
  Rejected: 'var(--color-red)',
  Withdrawn: '#9ca3af',
};

export default function Statistics() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api('/stats').then(setStats).catch(console.error);
  }, []);

  if (!stats) return null;

  const breakdown = stats.statusBreakdown || {};
  const max = Math.max(...Object.values(breakdown), 1);

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] max-md:grid-cols-2 gap-3 mb-6">
        <Card className="group py-6 px-5 text-center relative overflow-hidden transition-all hover:border-border hover:-translate-y-[3px] hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-ring opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="font-sans text-[2rem] font-bold text-foreground tracking-[-0.02em]">{stats.total}</div>
          <div className="text-[0.78rem] text-muted-foreground mt-[0.3rem] uppercase tracking-[0.06em] font-medium">Total Applications</div>
        </Card>
        <Card className="group py-6 px-5 text-center relative overflow-hidden transition-all hover:border-border hover:-translate-y-[3px] hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-ring opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="font-sans text-[2rem] font-bold text-foreground tracking-[-0.02em]">{stats.applied}</div>
          <div className="text-[0.78rem] text-muted-foreground mt-[0.3rem] uppercase tracking-[0.06em] font-medium">Applied</div>
        </Card>
        <Card className="group py-6 px-5 text-center relative overflow-hidden transition-all hover:border-border hover:-translate-y-[3px] hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-ring opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="font-sans text-[2rem] font-bold text-foreground tracking-[-0.02em]">{stats.avgScore || '-'}</div>
          <div className="text-[0.78rem] text-muted-foreground mt-[0.3rem] uppercase tracking-[0.06em] font-medium">Average Score</div>
        </Card>
        <Card className="group py-6 px-5 text-center relative overflow-hidden transition-all hover:border-border hover:-translate-y-[3px] hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary to-ring opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="font-sans text-[2rem] font-bold text-foreground tracking-[-0.02em]">{stats.responseRate}%</div>
          <div className="text-[0.78rem] text-muted-foreground mt-[0.3rem] uppercase tracking-[0.06em] font-medium">Response Rate</div>
        </Card>
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
