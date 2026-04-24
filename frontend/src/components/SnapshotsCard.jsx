import { useState } from 'react';

function prettyJson(raw) {
  if (raw == null) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function Panel({ label, body, empty }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="snapshots-card__panel">
      <div className="snapshots-card__panel-head">
        <span className="snapshots-card__panel-label">{label}</span>
        {body && (
          <button
            type="button"
            className="btn btn-secondary btn-sm snapshots-card__copy"
            onClick={copy}
          >
            {copied ? 'הועתק' : 'העתק'}
          </button>
        )}
      </div>
      {body ? (
        <pre className="snapshots-card__pre" dir="ltr">{body}</pre>
      ) : (
        <div className="snapshots-card__empty">{empty}</div>
      )}
    </div>
  );
}

export default function SnapshotsCard({ snapshots }) {
  const stages = [
    {
      key: 'analyst',
      label: 'אנליסט · Parse',
      hint: 'שלב הפרסינג',
      input: snapshots.analystInput,
      output: snapshots.analystOutput,
    },
    {
      key: 'evaluator',
      label: 'הערכה · Evaluate',
      hint: 'שלב הציון',
      input: snapshots.evaluatorInput,
      output: snapshots.evaluatorOutput,
    },
  ];

  return (
    <div className="snapshots-card">
      {stages.map((s) => {
        const hasAny = s.input || s.output;
        return (
          <div key={s.key} className="snapshots-card__stage">
            <div className="snapshots-card__stage-head">
              <span className="snapshots-card__stage-label">{s.label}</span>
              <span className="snapshots-card__stage-hint">{s.hint}</span>
            </div>
            {hasAny ? (
              <>
                <Panel
                  label="Input"
                  body={prettyJson(s.input)}
                  empty="אין קלט שמור"
                />
                <Panel
                  label="Output"
                  body={s.output}
                  empty="אין פלט שמור"
                />
              </>
            ) : (
              <div className="snapshots-card__empty">לא זמין — שלב דילג</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
