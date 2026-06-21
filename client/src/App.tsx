import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sun, Moon, ChevronDown } from 'lucide-react';
import { useTheme } from './lib/theme';
import { useConfig } from './lib/queries';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `relative py-[0.45rem] px-4 rounded-lg text-[0.82rem] font-medium transition-all ${isActive ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`;

const triggerClass = (active: boolean): string =>
  `relative flex items-center gap-1 py-[0.45rem] px-4 rounded-lg text-[0.82rem] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground ${active ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`;

type NavChild = { to: string; label: string };

const FIND_GROUP: NavChild[] = [
  { to: '/discovery', label: 'Discovery' },
  { to: '/score', label: 'Score a Job' },
];

const INTERVIEW_GROUP: NavChild[] = [
  { to: '/interview-prep', label: 'Interview Prep' },
  { to: '/practice-interview', label: 'Practice Interview' },
];

function NavGroup({ label, items }: { label: string; items: NavChild[] }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = items.some((item) => pathname.startsWith(item.to));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={triggerClass(active)}>
        {label}
        <ChevronDown size={13} className="opacity-60 transition-transform data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[10rem]">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.to}
            onSelect={() => navigate(item.to)}
            className={pathname.startsWith(item.to) ? 'bg-accent text-foreground' : ''}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { data: config } = useConfig();
  return (
    <div className="relative">
      {config?.demoMode && (
        <div className="bg-primary/10 text-foreground border-b border-border text-center text-[0.78rem] font-medium py-[0.4rem] px-4">
          Read-only demo — explore the sample data freely; changes are disabled.
        </div>
      )}
      <nav data-app-nav className="bg-background/80 backdrop-blur-[20px] border-b border-border sticky top-0 z-50">
        <div className="max-w-[1100px] mx-auto px-6 flex items-center justify-between h-14">
          <NavLink to="/" className="font-serif font-bold text-[0.95rem] text-foreground tracking-[0.02em] transition-opacity hover:opacity-75">NextRole</NavLink>
          <div className="flex items-center gap-[0.15rem]">
            <NavLink to="/" end className={navLinkClass}>Home</NavLink>
            <NavGroup label="Find" items={FIND_GROUP} />
            <NavLink to="/tracker" className={navLinkClass}>Tracker</NavLink>
            <NavGroup label="Interview" items={INTERVIEW_GROUP} />
            <NavLink to="/settings" className={navLinkClass}>Settings</NavLink>
            <button
              onClick={toggleTheme}
              className="ml-2 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
