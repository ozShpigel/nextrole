import { useState, useEffect } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import { useDiscoveryHealth, useDiscoveryCriteria, useDiscoveryRuns } from '../lib/queries';
import { useTriggerRun, useDeleteCriteria, useAbortRun } from '../lib/mutations';
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

export default function DiscoveryPage() {
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Criteria | null>(null);
  const [wakeElapsed, setWakeElapsed] = useState<number>(0);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  const healthQuery = useDiscoveryHealth();
  const criteriaQuery = useDiscoveryCriteria(healthQuery.isSuccess);
  const runsQuery = useDiscoveryRuns(healthQuery.isSuccess);

  const triggerRun = useTriggerRun();
  const deleteCriteria = useDeleteCriteria();
  const abortRun = useAbortRun();

  const wakingUp = healthQuery.isLoading && healthQuery.failureCount > 0;
  const wakeAttempt = healthQuery.failureCount;

  useEffect(() => {
    if (!wakingUp) {
      setWakeElapsed(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => {
      setWakeElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [wakingUp]);

  function handleTriggerRun(criteriaId: string): void {
    triggerRun.mutate(criteriaId, {
      onError: (e) => alert('Error starting search: ' + e.message),
    });
  }

  function handleDeleteCriteria(id: string): void {
    setConfirmState({
      message: 'Delete this search criteria?',
      onConfirm: () => {
        setConfirmState(null);
        deleteCriteria.mutate(id, {
          onError: (e) => alert('Delete failed: ' + e.message),
        });
      },
    });
  }

  function handleAbortRun(runId: string, e: React.MouseEvent): void {
    e.stopPropagation();
    setConfirmState({
      message: 'Abort this search?',
      onConfirm: () => {
        setConfirmState(null);
        abortRun.mutate(runId, {
          onError: (err) => alert('Abort failed: ' + err.message),
        });
      },
    });
  }

  function onSaved(): void {
    setShowForm(false);
    setEditItem(null);
  }

  function openForm(item: Criteria | null = null): void {
    setEditItem(item);
    setShowForm(true);
  }

  function closeForm(): void {
    setShowForm(false);
    setEditItem(null);
  }

  const criteria = criteriaQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const lastRun = runs[0]?.started_at;
  const loading = healthQuery.isLoading || (healthQuery.isSuccess && (criteriaQuery.isLoading || runsQuery.isLoading));
  const error = healthQuery.error ?? criteriaQuery.error ?? runsQuery.error;

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
      {error && <ErrorBanner error={error.message} onRetry={() => healthQuery.refetch()} />}

      {showForm && (
        <CriteriaForm initial={editItem} onSave={onSaved} onCancel={closeForm} />
      )}

      <CriteriaSection
        criteria={criteria}
        onEdit={openForm}
        onDelete={handleDeleteCriteria}
        onRun={handleTriggerRun}
        onNew={() => openForm()}
      />
      <RunsTimeline runs={runs} onAbort={handleAbortRun} />

      <ConfirmDialog
        open={!!confirmState}
        description={confirmState?.message ?? ''}
        confirmLabel={confirmState?.message.startsWith('Abort') ? 'Abort' : 'Delete'}
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
