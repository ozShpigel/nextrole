import { useState, useEffect, useMemo, useRef } from 'react';
import { discoveryApi } from '../utils/api';
import { CriteriaForm, CriteriaSection } from '../components/CriteriaPanel';
import DiscoveryLoadingSkeleton from '../components/DiscoveryLoadingSkeleton';
import PageHeader from '../components/PageHeader';
import { StatStrip } from '../components/Stats';
import { ErrorBanner } from '../components/Error';
import { RunsTimeline } from '../components/RunsTimeline';
import WakeUpIndicator from '../components/WakeUpIndicator';

export default function DiscoveryPage() {
  const [criteria, setCriteria] = useState([]);
  const [runs, setRuns] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [wakingUp, setWakingUp] = useState(false);
  const [wakeAttempt, setWakeAttempt] = useState(0);
  const [wakeStartedAt, setWakeStartedAt] = useState(null);
  const [wakeElapsed, setWakeElapsed] = useState(0);
  const pollRef = useRef(null);

  useEffect(() => { load(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  useEffect(() => {
    if (!wakingUp || !wakeStartedAt) return;
    const id = setInterval(() => {
      setWakeElapsed(Math.floor((Date.now() - wakeStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [wakingUp, wakeStartedAt]);

  async function load() {
    setLoading(true);
    setError(null);
    setWakingUp(false);
    setWakeAttempt(0);
    setWakeStartedAt(null);
    setWakeElapsed(0);
    const onRetry = ({ attempt }) => {
      setWakingUp(true);
      setWakeAttempt(attempt);
      setWakeStartedAt((prev) => prev ?? Date.now());
    };
    try {
      await discoveryApi('/health', {
        onRetry,
        retries: 5,
        retryMinDelayMs: 20000,
        retryMaxDelayMs: 25000,
      });
      setWakingUp(false);
      const c = await discoveryApi('/criteria', { onRetry });
      setCriteria(c);
      const r = await discoveryApi('/runs', { onRetry });
      setRuns(r);
      startPollingIfNeeded(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setWakingUp(false);
    }
  }

  function startPollingIfNeeded(runsList) {
    if (pollRef.current) clearInterval(pollRef.current);
    const hasActive = runsList.some((r) => r.status === 'pending' || r.status === 'scraping' || r.status === 'scoring');
    if (!hasActive) return;
    pollRef.current = setInterval(async () => {
      try {
        const c = await discoveryApi('/criteria');
        setCriteria(c);
        const r = await discoveryApi('/runs');
        setRuns(r);
        if (!r.some((run) => run.status === 'pending' || run.status === 'scraping' || run.status === 'scoring')) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  async function triggerRun(criteriaId) {
    try {
      await discoveryApi(`/run/${criteriaId}`, { method: 'POST' });
      load();
    } catch (e) {
      alert('Error starting search: ' + e.message);
    }
  }

  async function deleteCriteria(id) {
    if (!confirm('Delete this search criteria?')) return;
    try {
      await discoveryApi(`/criteria/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }

  async function abortRun(runId, e) {
    e.stopPropagation();
    if (!confirm('Abort this search?')) return;
    try {
      await discoveryApi(`/runs/${runId}/abort`, { method: 'POST' });
      load();
    } catch (err) {
      alert('Abort failed: ' + err.message);
    }
  }

  function onSaved() {
    setShowForm(false);
    setEditItem(null);
    load();
  }

  function openForm(item = null) {
    setEditItem(item);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditItem(null);
  }

  const lastRun = useMemo(() => runs[0]?.started_at, [runs]);

  if (loading) {
    return (
      <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
        <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
        <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />
        {wakingUp ? (
          <WakeUpIndicator attempt={wakeAttempt} elapsed={wakeElapsed} />
        ) : (
          <DiscoveryLoadingSkeleton />
        )}
      </div>
    );
  }

  return (
    <div className="relative max-w-[960px] mx-auto px-7 pt-14 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 isolate max-[640px]:px-4 max-[640px]:pt-10 max-[640px]:pb-14">
      <div className="absolute -top-[140px] -right-[220px] w-[540px] h-[540px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 65%)' }} />
      <div className="absolute top-[40%] -left-[200px] w-[420px] h-[420px] blur-[60px] pointer-events-none -z-1" style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 65%)' }} />

      <PageHeader onNewCriteria={() => openForm()} />
      <StatStrip criteriaCount={criteria.length} runsCount={runs.length} lastRun={lastRun} />
      {error && <ErrorBanner error={error} onRetry={load} />}

      {showForm && (
        <CriteriaForm initial={editItem} onSave={onSaved} onCancel={closeForm} />
      )}

      <CriteriaSection
        criteria={criteria}
        onEdit={openForm}
        onDelete={deleteCriteria}
        onRun={triggerRun}
        onNew={() => openForm()}
      />
      <RunsTimeline runs={runs} onAbort={abortRun} />
    </div>
  );
}
