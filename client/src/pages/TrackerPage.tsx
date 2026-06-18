import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Dashboard from '../components/Dashboard';
import ApplicationList from '../components/ApplicationList';
import AddApplication from '../components/AddApplication';
import Statistics from '../components/Statistics';

interface Tab {
  key: string;
  label: string;
}

const TABS: Tab[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'list', label: 'Applications' },
  { key: 'add', label: 'Add Application' },
  { key: 'stats', label: 'Statistics' },
];

const TODAY = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});

export default function TrackerPage() {
  const location = useLocation();
  const initialTab = (location.state as { tab?: string } | null)?.tab || 'dashboard';
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  function switchTab(tab: string): void {
    setActiveTab(tab);
  }

  return (
    <div className="editorial editorial-grain min-h-[calc(100vh-56px)] animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="relative z-[1] max-w-[1100px] mx-auto px-8 pt-12 pb-16 max-[640px]:px-5 max-[640px]:pt-8">
        {/* Masthead */}
        <header className="mb-7">
          <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[var(--ed-ink-faint)]">
            <span>Vol. III · Tracker</span>
            <span className="tabular-nums">{TODAY}</span>
          </div>
          <h1 className="ed-display font-black text-[clamp(2.4rem,6vw,4rem)] leading-[0.92] tracking-[-0.02em] text-[var(--ed-ink)] pt-4">
            Application <span className="italic font-medium text-[var(--ed-accent)]">Tracker</span>
          </h1>
          <p className="mt-3 max-w-[560px] text-[0.95rem] leading-[1.6] text-[var(--ed-ink-soft)]">
            Manage and track your hiring processes
          </p>
          <div className="mt-5 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
        </header>

        {/* Editorial tab bar */}
        <div className="flex gap-7 mb-9 border-b border-[var(--ed-rule)] max-md:gap-5 max-md:flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`relative -mb-px pb-3 pt-1 bg-transparent border-none cursor-pointer text-[0.78rem] font-semibold uppercase tracking-[0.1em] transition-colors ${activeTab === t.key ? 'text-[var(--ed-ink)] border-b-2 border-[var(--ed-accent)]' : 'text-[var(--ed-ink-faint)] border-b-2 border-transparent hover:text-[var(--ed-ink)]'}`}
              onClick={() => switchTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'list' && <ApplicationList />}
        {activeTab === 'add' && <AddApplication onSaved={() => switchTab('list')} />}
        {activeTab === 'stats' && <Statistics />}
      </div>
    </div>
  );
}
