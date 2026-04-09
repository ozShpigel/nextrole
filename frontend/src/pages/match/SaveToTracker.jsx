import { useState } from 'react';
import { Link } from 'react-router-dom';

async function waitForTrackerReady(onProgress, maxWaitMs = 120000, intervalMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const r = await fetch('/api/match/tracker-ready');
      if (r.ok) return true;
    } catch (_) { /* cold start */ }
    const elapsed = Math.floor((Date.now() - start) / 1000);
    onProgress(`מעירים את שירות המעקב... (${elapsed} שניות)`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export default function SaveToTracker({ analysis, jobDescription }) {
  const [title, setTitle] = useState(analysis?.jobTitle || '');
  const [company, setCompany] = useState(analysis?.company || '');
  const [status, setStatus] = useState('analyzing');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { type: 'success'|'error'|'warning', message, showLink }

  async function save() {
    if (!title.trim() || !company.trim()) {
      setResult({ type: 'error', message: 'נא למלא תפקיד וחברה' });
      return;
    }

    setSaving(true);
    setResult(null);

    try {
      setResult({ type: 'info', message: 'בודקים זמינות שירות המעקב...' });

      const ready = await waitForTrackerReady((msg) => {
        setResult({ type: 'info', message: msg });
      });

      if (!ready) {
        setResult({ type: 'error', message: 'שירות המעקב לא נענה בזמן (עד שתי דקות). נסו שוב או פתחו את המעקב בדפדפן כדי להעיר אותו.' });
        return;
      }

      setResult({ type: 'info', message: 'שומר...' });

      const res = await fetch('/api/match/save-to-tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle: title.trim(),
          company: company.trim(),
          matchScore: analysis?.overallScore,
          matchVerdict: analysis?.verdict,
          jobDescription,
          matchAnalysis: JSON.stringify(analysis),
          cvSent: status === 'applied',
        }),
      });

      if (res.status === 409) {
        const data = await res.json();
        setResult({ type: 'warning', message: data.message || 'Application already exists in tracker' });
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setResult({ type: 'success', message: data.message, showLink: true });
      } else {
        setResult({ type: 'error', message: 'שגיאה בשמירה. ודאו ש-ApplicationTracker פעיל.' });
      }
    } catch (e) {
      setResult({ type: 'error', message: 'לא ניתן להתחבר ל-ApplicationTracker. ודאו שהוא פעיל.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="save-tracker">
      <h3>שמירה במעקב מועמדויות</h3>
      <p>שמרו משרה זו במעקב למעקב המשך</p>

      <div className="form-row">
        <div>
          <label className="form-label">תפקיד</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="שם התפקיד" />
        </div>
        <div>
          <label className="form-label">חברה</label>
          <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="שם החברה" />
        </div>
      </div>

      <label className="radio-label">
        <input type="radio" name="saveStatus" value="analyzing" checked={status === 'analyzing'} onChange={() => setStatus('analyzing')} />
        רק ניתחתי (עוד לא שלחתי קו&quot;ח)
      </label>
      <label className="radio-label">
        <input type="radio" name="saveStatus" value="applied" checked={status === 'applied'} onChange={() => setStatus('applied')} />
        כבר שלחתי קו&quot;ח
      </label>

      <button className="save-btn" onClick={save} disabled={saving}>שמירה במעקב</button>

      {result && (
        <div className={`save-result ${result.type}`}>
          {result.message}
          {result.showLink && (
            <>
              {' '}<Link to="/tracker">פתיחת מעקב</Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
