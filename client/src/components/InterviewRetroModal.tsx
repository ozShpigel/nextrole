import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CategoryToggleChips } from './CategoryToggleChips';
import { MicButton, type MicControl } from './MicButton';

// No language selector here (unlike Mock Interview) — the retro modal is a
// compact, single-purpose form. Hebrew-IL matches the app's default bias
// (Mock Interview also defaults to 'he'); dictation still transcribes English
// speech reasonably well under he-IL.
const DICTATION_LANG = 'he-IL';

export interface InterviewRetro {
  retroRating: number | null;
  retroWentWell: string;
  retroToImprove: string;
  retroCategories: string[];
}

interface InterviewRetroModalProps {
  interviewType: string;
  onSave: (retro: InterviewRetro) => void;
  onSkip: () => void;
}

// Separate, lightweight retro capture — shown right after an interview is
// marked Completed. Portal-rendered (shadcn Dialog mounts outside the
// .editorial subtree), so this uses neutral shadcn tokens throughout, never
// --ed-* (see docs/design-system.md's portal caveat).
export function InterviewRetroModal({ interviewType, onSave, onSkip }: InterviewRetroModalProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [wentWell, setWentWell] = useState('');
  const [toImprove, setToImprove] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [dictatingWentWell, setDictatingWentWell] = useState(false);
  const [dictatingToImprove, setDictatingToImprove] = useState(false);
  const wentWellMicRef = useRef<MicControl | null>(null);
  const toImproveMicRef = useRef<MicControl | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  function save(): void {
    wentWellMicRef.current?.cancel();
    toImproveMicRef.current?.cancel();
    onSave({ retroRating: rating, retroWentWell: wentWell, retroToImprove: toImprove, retroCategories: categories });
  }

  function skip(): void {
    wentWellMicRef.current?.cancel();
    toImproveMicRef.current?.cancel();
    onSkip();
  }

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) skip(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How did it go?</DialogTitle>
          <DialogDescription>
            Quick retro on your {interviewType} interview — helps surface patterns later in Interview Insights.
          </DialogDescription>
        </DialogHeader>
        <div className="mb-5">
          <Label>Self-rating</Label>
          <div className="mt-1.5 flex items-center gap-1.5" role="group" aria-label="Self-rating, 1 to 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={rating === n}
                onClick={() => setRating(n)}
                className={`h-9 w-9 rounded-full border text-[0.88rem] font-semibold transition-all ${
                  rating === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-5">
          <Label>What went well</Label>
          <div className="mt-1.5 flex items-start gap-2">
            <Textarea
              aria-label="What went well"
              value={wentWell}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { if (!dictatingWentWell) setWentWell(e.target.value); }}
              readOnly={dictatingWentWell}
              dir="auto"
              className="min-h-[90px]"
            />
            <MicButton
              lang={DICTATION_LANG}
              disabled={false}
              onText={setWentWell}
              getBase={() => wentWell}
              onListeningChange={setDictatingWentWell}
              onError={setMicError}
              controlRef={wentWellMicRef}
              variant="neutral"
            />
          </div>
        </div>
        <div className="mb-5">
          <Label>What to improve</Label>
          <div className="mt-1.5 flex items-start gap-2">
            <Textarea
              aria-label="What to improve"
              value={toImprove}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { if (!dictatingToImprove) setToImprove(e.target.value); }}
              readOnly={dictatingToImprove}
              dir="auto"
              className="min-h-[90px]"
            />
            <MicButton
              lang={DICTATION_LANG}
              disabled={false}
              onText={setToImprove}
              getBase={() => toImprove}
              onListeningChange={setDictatingToImprove}
              onError={setMicError}
              controlRef={toImproveMicRef}
              variant="neutral"
            />
          </div>
        </div>
        <div className="mb-5">
          <Label>Categories</Label>
          <div className="mt-1.5">
            <CategoryToggleChips value={categories} onChange={setCategories} variant="neutral" />
          </div>
        </div>
        {micError && <p className="text-[0.8rem] text-destructive -mt-2 mb-3">{micError}</p>}
        <DialogFooter>
          <Button onClick={save} disabled={rating === null}>Save retro</Button>
          <Button variant="outline" onClick={skip}>Skip</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
