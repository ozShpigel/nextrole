import { useState, useEffect, useMemo, useRef } from 'react';
import { discoveryApi } from '../lib/api';
import { CriteriaForm, CriteriaSection } from '../components/CriteriaPanel';
import DiscoveryLoadingSkeleton from '../components/DiscoveryLoadingSkeleton';
import PageHeader from '../components/PageHeader';
import { StatStrip } from '../components/Stats';
import { ErrorBanner } from '../components/Error';
import { RunsTimeline } from '../components/RunsTimeline';
import WakeUpIndicator from '../components/WakeUpIndicator';

interface Criteria {
  id: string;
  name: string;
  job_titles: string[];
  locations: string[];
  site_names: string[];
  results_wanted: number;
  hours_old: number;
  country: string;
  is_remote: boolean | null;
  min_score_to_save: number;
}

interface Run {
  id: string;
  status: string;
  criteria_name: string;
  jobs_scraped: number;
  jobs_scored: number;
  jobs_saved: number;
  jobs_skipped_duplicate: number;
  started_at?: string;
  error?: string;
}

interface RetryInfo {
  attempt: number;
}

export default function DiscoveryPage() {
  const [criteria, setCriteria] = useState<Criteria[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Criteria | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [wakingUp, setWakingUp] = useState<boolean>(false);
  const [wakeAttempt, setWakeAttempt] = useState<number>(0);
  const [wakeStartedAt, setWakeStartedAt] = useState<number | null>(null);
  const [wakeElapsed, setWakeElapsed] = useState<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { load(); return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);

  useEffect(() => {
    if (!wakingUp || !wakeStartedAt) return;
    const id = setInterval(() => {
      setWakeElapsed(Math.floor((Date.now() - wakeStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [wakingUp, wakeStartedAt]);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    setWakingUp(false);
    setWakeAttempt(0);
    setWakeStartedAt(null);
    setWakeElapsed(0);
    const onRetry = ({ attempt }: RetryInfo) => {
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
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setWakingUp(false);
    }
  }

  function startPollingIfNeeded(runsList: Run[]): void {
    if (pollRef.current) clearInterval(pollRef.current);
    const hasActive = runsList.some((r) => r.status === 'pending' || r.status === 'scraping' || r.status === 'scoring');
    if (!hasActive) return;
    pollRef.current = setInterval(async () => {
      try {
        const c = await discoveryApi('/criteria');
        setCriteria(c);
        const r = await discoveryApi('/runs');
        setRuns(r);
        if (!r.some((run: Run) => run.status === 'pending' || run.status === 'scraping' || run.status === 'scoring')) {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* keep polling */ }
    }, 5000);
  }

  async function triggerRun(criteriaId: string): Promise<void> {
    try {
      await discoveryApi(`/run/${criteriaId}`, { method: 'POST' });
      load();
    } catch (e) {
      alert('Error starting search: ' + (e as Error).message);
    }
  }

  async function deleteCriteria(id: string): Promise<void> {
    if (!confirm('Delete this search criteria?')) return;
    try {
      await discoveryApi(`/criteria/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      alert('Delete failed: ' + (e as Error).message);
    }
  }

  async function abortRun(runId: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    if (!confirm('Abort this search?')) return;
    try {
      await discoveryApi(`/runs/${runId}/abort`, { method: 'POST' });
      load();
    } catch (err) {
      alert('Abort failed: ' + (err as Error).message);
    }
  }

  function onSaved(): void {
    setShowForm(false);
    setEditItem(null);
    load();
  }

  function openForm(item: Criteria | null = null): void {
    setEditItem(item);
    setShowForm(true);
  }

  function closeForm(): void {
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
