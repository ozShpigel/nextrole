import { NavLink, Outlet } from 'react-router-dom';

const navLinkClass = ({ isActive }) =>
  `relative py-[0.45rem] px-4 rounded-lg text-[0.82rem] font-medium transition-all ${isActive ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`;

export default function App() {
  return (
    <div className="relative">
      <nav data-app-nav className="bg-background/80 backdrop-blur-[20px] border-b border-border sticky top-0 z-50">
        <div className="max-w-[1100px] mx-auto px-6 flex items-center justify-between h-14">
          <NavLink to="/" className="font-serif font-bold text-[0.95rem] text-foreground tracking-[0.02em] transition-opacity hover:opacity-75">NextRole</NavLink>
          <div className="flex gap-[0.15rem]">
            <NavLink to="/" end className={navLinkClass}>Home</NavLink>
            <NavLink to="/discovery" className={navLinkClass}>Discovery</NavLink>
            <NavLink to="/tracker" className={navLinkClass}>Tracker</NavLink>
            <NavLink to="/settings" className={navLinkClass}>Settings</NavLink>
          </div>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
