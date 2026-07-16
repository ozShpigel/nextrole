import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
      onError: (e) => alert('Error starting collection: ' + e.message),
    });
  }

  function handleDeleteCriteria(id: string): void {
    setConfirmState({
      message: 'Delete this collection criteria?',
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
      message: 'Abort this collection run?',
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
      <div className="editorial editorial-grain min-h-screen">
        <div className="relative z-[1] max-w-[1040px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">
          {wakingUp ? (
            <WakeUpIndicator attempt={wakeAttempt} elapsed={wakeElapsed} />
          ) : (
            <DiscoveryLoadingSkeleton />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="editorial editorial-grain min-h-screen">
      <div className="relative z-[1] max-w-[1040px] mx-auto px-8 pt-12 pb-20 animate-in fade-in slide-in-from-bottom-1 duration-500 max-[640px]:px-5 max-[640px]:pt-8 max-[640px]:pb-14">

      <PageHeader onNewCriteria={() => openForm()} />
      <StatStrip criteriaCount={criteria.length} runsCount={runs.length} lastRun={lastRun} />

      {/* Discovery only collects — the payoff lives on the Search page. */}
      <div className="flex items-center justify-between gap-4 flex-wrap border border-[var(--ed-rule)] bg-[var(--ed-panel)]/40 px-4 py-3 mb-9 text-[0.84rem]">
        <span className="text-[var(--ed-ink-soft)]">
          Runs collect and embed jobs into the pool — matching against your profile happens on the Search page.
        </span>
        <Link
          to="/search"
          className="shrink-0 text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-[var(--ed-accent)] hover:text-[var(--ed-accent-deep)] transition-colors"
        >
          Search your matches →
        </Link>
      </div>

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
    </div>
  );
}
