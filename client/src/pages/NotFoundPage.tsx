import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center bg-background animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="text-center px-6">
        <span className="font-serif text-[6rem] font-bold text-muted-foreground/30 leading-none tracking-[-0.04em]">404</span>
        <h1 className="font-serif text-[1.6rem] font-bold text-foreground mt-2 mb-2 tracking-[-0.01em]">Page not found</h1>
        <p className="text-muted-foreground text-[0.92rem] mb-6 max-w-[360px] mx-auto leading-[1.6]">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Button asChild>
          <Link to="/">Back to Home</Link>
        </Button>
      </div>
    </div>
  );
}
