import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Dashboard from './Dashboard';
import ApplicationList from './ApplicationList';
import AddApplication from './AddApplication';
import Statistics from './Statistics';
import '../../styles/tracker.css';

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
    <div className="tracker">
      <div className="tracker-header">
        <h1>מעקב משרות</h1>
        <p className="subtitle">ניהול ומעקב אחר תהליכי גיוס</p>
      </div>

      <div className="container">
        <div className="tracker-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tracker-tab${activeTab === t.key ? ' active' : ''}`}
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
