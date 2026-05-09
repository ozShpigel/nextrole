import { CriteriaForm, CriteriaSection } from '../components/CriteriaPanel';
import DiscoveryLoadingSkeleton from '../components/DiscoveryLoadingSkeleton';
import useDiscovery from '../hooks/useDiscovery';
import PageHeader from '../components/PageHeader';
import { StatStrip } from '../components/Stats';
import { ErrorBanner } from '../components/Error';
import { RunsTimeline } from '../components/RunsTimeline';
import WakeUpIndicator from '../components/WakeUpIndicator';

export default function DiscoveryPage() {
  const {
    criteria, runs, showForm, editItem, loading, error,
    wakingUp, wakeAttempt, wakeElapsed, lastRun,
    load, triggerRun, deleteCriteria, abortRun, onSaved, openForm, closeForm,
  } = useDiscovery();

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
