import { useState, useEffect, useMemo, useRef } from 'react';
import { discoveryApi } from '../utils/api';

export default function useDiscovery() {
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

  useEffect(() => { load(); return () => clearInterval(pollRef.current); }, []);

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
    clearInterval(pollRef.current);
    const hasActive = runsList.some((r) => r.status === 'pending' || r.status === 'scraping' || r.status === 'scoring');
    if (!hasActive) return;
    pollRef.current = setInterval(async () => {
      try {
        const c = await discoveryApi('/criteria');
        setCriteria(c);
        const r = await discoveryApi('/runs');
        setRuns(r);
        if (!r.some((run) => run.status === 'pending' || run.status === 'scraping' || run.status === 'scoring')) {
          clearInterval(pollRef.current);
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

  return {
    criteria,
    runs,
    showForm,
    editItem,
    loading,
    error,
    wakingUp,
    wakeAttempt,
    wakeElapsed,
    lastRun,
    load,
    triggerRun,
    deleteCriteria,
    abortRun,
    onSaved,
    openForm,
    closeForm,
  };
}
