import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Dashboard from './Dashboard';
import ApplicationList from './ApplicationList';
import AddApplication from './AddApplication';
import Statistics from './Statistics';

const TABS = [
  { key: 'dashboard', label: 'דשבורד' },
  { key: 'list', label: 'רשימת משרות' },
  { key: 'add', label: 'הוסף משרה' },
  { key: 'stats', label: 'סטטיסטיקות' },
];

export default function TrackerPage() {
  const location = useLocation();
  const initialTab = location.state?.tab || 'dashboard';
  const [activeTab, setActiveTab] = useState(initialTab);

  function switchTab(tab) {
    setActiveTab(tab);
  }

  return (
    <div className="min-h-[calc(100vh-56px)] bg-bg-deep animate-page-in-fast">
      <div className="bg-bg-surface border-b border-border py-5 mb-8">
        <h1 className="font-sans text-[1.4rem] font-bold text-text-bright max-w-[1100px] mx-auto px-6 tracking-[-0.01em]">מעקב משרות</h1>
        <p className="text-text-secondary text-[0.85rem] max-w-[1100px] mt-[0.15rem] mx-auto px-6">ניהול ומעקב אחר תהליכי גיוס</p>
      </div>

      <div className="max-w-[1100px] mx-auto px-6 pb-8">
        <div className="flex gap-1 mb-8 bg-bg-card rounded p-[0.3rem] border border-border shadow-sm max-md:flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`py-[0.55rem] px-5 bg-transparent border-none rounded-[7px] cursor-pointer text-[0.85rem] font-medium font-sans transition-all hover:text-text-primary ${activeTab === t.key ? 'text-accent bg-accent-muted' : 'text-text-dim'}`}
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
