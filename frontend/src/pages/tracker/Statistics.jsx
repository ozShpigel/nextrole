import { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import { STATUS_HE } from '../../utils/constants';

const BAR_COLORS = {
  Analyzing: 'var(--yellow)',
  DecidedToApply: 'var(--purple)',
  Applied: 'var(--blue)',
  PhoneScreen: 'var(--green)',
  TechnicalInterview: 'var(--green)',
  FinalRound: 'var(--green)',
  OfferReceived: '#6ee7b7',
  Accepted: 'var(--green)',
  Rejected: 'var(--red)',
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
      <div className="summary-grid">
        <div className="summary-card"><div className="value">{stats.total}</div><div className="label">סה&quot;כ משרות</div></div>
        <div className="summary-card"><div className="value">{stats.applied}</div><div className="label">הוגשו</div></div>
        <div className="summary-card"><div className="value">{stats.avgScore || '-'}</div><div className="label">ציון ממוצע</div></div>
        <div className="summary-card"><div className="value">{stats.responseRate}%</div><div className="label">אחוז מענה</div></div>
      </div>

      <div className="card mt-1">
        <h3 className="section-title">התפלגות לפי סטטוס</h3>
        <div className="stat-bars">
          {Object.entries(STATUS_HE).map(([key, label]) => {
            const count = breakdown[key] || 0;
            const pct = (count / max * 100).toFixed(0);
            const color = BAR_COLORS[key] || 'var(--accent)';
            return (
              <div key={key} className="stat-bar-row">
                <span className="stat-bar-label">{label}</span>
                <div className="stat-bar-bg">
                  <div className="stat-bar-fill" style={{ width: `${pct}%`, background: color }}>
                    {count > 0 ? count : ''}
                  </div>
                </div>
                <span className="stat-bar-count">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
