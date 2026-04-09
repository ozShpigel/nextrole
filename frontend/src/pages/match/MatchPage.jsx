import { useState } from 'react';
import { matchApi } from '../../utils/api';
import MatchResult from './MatchResult';
import SaveToTracker from './SaveToTracker';
import '../../styles/match.css';

export default function MatchPage() {
  const [jobDescription, setJobDescription] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function analyze() {
    const desc = jobDescription.trim();
    if (!desc) return;

    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const data = await matchApi('', {
        method: 'POST',
        body: JSON.stringify({ jobDescription: desc }),
      });
      setAnalysis(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="match-page">
      <h1>שירות התאמת משרות</h1>
      <p className="subtitle">הדביקו תיאור משרה למטה לניתוח התאמה</p>

      <textarea
        value={jobDescription}
        onChange={(e) => setJobDescription(e.target.value)}
        placeholder="הדביקו כאן את תיאור המשרה המלא..."
      />
      <button
        className="analyze-btn"
        onClick={analyze}
        disabled={loading || !jobDescription.trim()}
      >
        {loading ? 'מנתח...' : 'ניתוח התאמה'}
      </button>

      {loading && <p className="match-loading">קורא ל-Claude API... זה לוקח 15-30 שניות</p>}
      {error && <div className="match-error">{error}</div>}
      {analysis && (
        <>
          <MatchResult data={analysis} />
          <SaveToTracker analysis={analysis} jobDescription={jobDescription} />
        </>
      )}
    </div>
  );
}
