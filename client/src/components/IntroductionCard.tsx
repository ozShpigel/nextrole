import { useState } from 'react';
import { STATUS_INTRO_MAP, INTRO_LABELS } from '../lib/tracker';
import { Card } from '@/components/ui/card';

interface IntroductionCardProps {
  status: string;
  elevatorPitch?: string;
  professionalIntro?: string;
  extendedIntro?: string;
}

export default function IntroductionCard({ status, elevatorPitch, professionalIntro, extendedIntro }: IntroductionCardProps) {
  const keys = STATUS_INTRO_MAP[status];
  if (!keys) return null;

  const texts: Record<string, string | undefined> = { elevatorPitch, professionalIntro, extendedIntro };
  const entries = keys.filter(k => texts[k]).map(k => ({ key: k, label: INTRO_LABELS[k], text: texts[k]! }));
  if (entries.length === 0) return null;

  return (
    <Card className="p-6 mb-4 transition-all hover:border-border hover:shadow-md">
      <h3 className="text-[0.95rem] font-semibold text-foreground mb-4">Self-Introduction</h3>
      <div className="flex flex-col gap-4">
        {entries.map(({ key, label, text }) => (
          <IntroBlock key={key} label={label} text={text} />
        ))}
      </div>
    </Card>
  );
}

interface IntroBlockProps {
  label: string;
  text: string;
}

function IntroBlock({ label, text }: IntroBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div>
      <span className="text-[0.72rem] text-muted-foreground py-[0.22rem] px-[0.7rem] rounded-full bg-muted/40 border border-border tracking-[0.03em] font-medium inline-block mb-2">
        {label}
      </span>
      <div className="relative">
        <p
          dir="rtl"
          className="text-[0.88rem] leading-[1.75] text-foreground whitespace-pre-wrap bg-background border border-border rounded p-5 m-0 text-right"
        >
          {text}
        </p>
        <button
          type="button"
          onClick={copyToClipboard}
          className="absolute top-3 left-3 py-[0.3rem] px-[0.6rem] rounded-md text-[0.72rem] font-medium border border-border bg-card text-muted-foreground cursor-pointer transition-all hover:border-foreground/30 hover:text-foreground"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
