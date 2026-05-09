import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

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
    <div className="bg-muted border border-border rounded p-4 mb-2">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[0.75rem] font-medium text-muted-foreground uppercase tracking-[0.06em]">{label}</span>
        {body && (
          <button
            type="button"
            className="px-2 py-1 text-[0.75rem] font-medium bg-muted border border-border rounded-sm text-muted-foreground hover:border-border hover:text-foreground transition-all"
            onClick={copy}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      {body ? (
        <pre className="text-[0.78rem] leading-relaxed bg-muted/50 border border-border rounded p-3 overflow-x-auto whitespace-pre-wrap font-code text-foreground" dir="ltr">{body}</pre>
      ) : (
        <div className="text-[0.84rem] text-muted-foreground py-2 text-center">{empty}</div>
      )}
    </div>
  );
}

export function SnapshotsCard({ snapshots }) {
  const stages = [
    {
      key: 'analyst',
      label: 'Analyst · Parse',
      hint: 'Parsing stage',
      input: snapshots.analystInput,
      output: snapshots.analystOutput,
    },
    {
      key: 'evaluator',
      label: 'Evaluator · Evaluate',
      hint: 'Scoring stage',
      input: snapshots.evaluatorInput,
      output: snapshots.evaluatorOutput,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {stages.map((s) => {
        const hasAny = s.input || s.output;
        return (
          <div key={s.key} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-[0.9rem] font-semibold text-foreground">{s.label}</span>
              <span className="text-[0.75rem] text-muted-foreground">{s.hint}</span>
            </div>
            {hasAny ? (
              <>
                <Panel
                  label="Input"
                  body={prettyJson(s.input)}
                  empty="No saved input"
                />
                <Panel
                  label="Output"
                  body={s.output}
                  empty="No saved output"
                />
              </>
            ) : (
              <div className="text-[0.84rem] text-muted-foreground py-2 text-center">Not available — stage skipped</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SnapshotsModal({ title, snapshots, onClose }) {
  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-[0.95rem] font-semibold">
            Raw Claude Calls
          </DialogTitle>
          {title && <DialogDescription className="text-[0.84rem]">{title}</DialogDescription>}
        </DialogHeader>
        <div className="overflow-y-auto">
          <SnapshotsCard snapshots={snapshots} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
