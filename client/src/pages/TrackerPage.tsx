import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

export default function TrackerPage() {
  const location = useLocation();
  const initialTab = (location.state as { tab?: string } | null)?.tab || 'dashboard';
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  function switchTab(tab: string): void {
    setActiveTab(tab);
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-background animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="bg-muted border-b border-border py-5 mb-8">
        <h1 className="font-sans text-[1.4rem] font-bold text-foreground max-w-[1100px] mx-auto px-6 tracking-[-0.01em]">Application Tracker</h1>
        <p className="text-muted-foreground text-[0.85rem] max-w-[1100px] mt-[0.15rem] mx-auto px-6">Manage and track your hiring processes</p>
      </div>

      <div className="max-w-[1100px] mx-auto px-6 pb-8">
        <div className="flex gap-1 mb-8 bg-card rounded p-[0.3rem] border border-border shadow-sm max-md:flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`py-[0.55rem] px-5 bg-transparent border-none rounded-[7px] cursor-pointer text-[0.85rem] font-medium font-sans transition-all hover:text-foreground hover:bg-accent ${activeTab === t.key ? 'text-foreground bg-accent' : 'text-muted-foreground'}`}
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
