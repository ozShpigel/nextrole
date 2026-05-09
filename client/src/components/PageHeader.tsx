import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';

interface PageHeaderProps {
  onNewCriteria: () => void;
}

export default function PageHeader({ onNewCriteria }: PageHeaderProps) {
  return (
    <header className="mb-8 relative">
      <div className="flex items-start justify-between gap-4 max-[640px]:flex-col">
        <div>
          <Badge variant="outline" className="font-mono text-[0.65rem] tracking-[0.26em] uppercase text-muted-foreground font-medium border-border bg-muted/50 mb-[1.2rem]">Discovery · LinkedIn + Indeed</Badge>
          <h1 className="font-serif text-[clamp(2rem,4vw,2.7rem)] font-bold text-foreground leading-[1.1] mb-[0.65rem] tracking-[-0.01em]">Job Discovery</h1>
          <p className="text-muted-foreground text-[0.95rem] max-w-[560px] leading-[1.6]">
            Automated job search from LinkedIn and Indeed with AI-powered scoring and matching via Claude.
          </p>
        </div>
        <Button onClick={onNewCriteria}>
          + New Criteria
        </Button>
      </div>
      <Separator className="mt-[1.6rem]" />
    </header>
  );
}
