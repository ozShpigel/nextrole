import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Dashboard from '../components/Dashboard';
import ApplicationList from '../components/ApplicationList';

interface Tab {
  key: string;
  label: string;
}

const TABS: Tab[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'list', label: 'List' },
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
      <div className="relative z-[1] max-w-[1800px] mx-auto px-8 pt-12 pb-16 max-[640px]:px-5 max-[640px]:pt-8">
        {/* Masthead */}
        <header className="mb-7">
          <div className="flex items-baseline justify-between gap-4 pb-[10px] border-b border-[var(--ed-rule)] text-[13px] font-medium uppercase tracking-[0.18em] text-[var(--ed-ink-faint)]">
            <span>Applications</span>
            <span className="tabular-nums">{TODAY}</span>
          </div>
          <h1 className="font-medium text-[40px] leading-[1.1] tracking-[-0.01em] text-[var(--ed-ink)] pt-4">
            Applications
          </h1>
          <div className="mt-5 border-t-[3px] border-double border-[var(--ed-rule-strong)]" />
        </header>

        {/* Tab bar */}
        <div className="flex gap-7 mb-9 border-b border-[var(--ed-rule)] max-md:gap-5 max-md:flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`relative -mb-px pb-3 pt-1 bg-transparent border-none cursor-pointer text-[13px] font-medium uppercase tracking-[0.08em] transition-colors ${activeTab === t.key ? 'text-[var(--ed-ink)] border-b-2 border-[var(--ed-accent)]' : 'text-[var(--ed-ink-faint)] border-b-2 border-transparent hover:text-[var(--ed-ink)]'}`}
              onClick={() => switchTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'list' && <ApplicationList />}
      </div>
    </div>
  );
}
