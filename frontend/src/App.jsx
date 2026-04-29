import { NavLink, Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div className="relative">
      <nav data-app-nav className="bg-[rgba(254,252,248,0.8)] backdrop-blur-[20px] border-b border-border sticky top-0 z-50">
        <div className="max-w-[1100px] mx-auto px-6 flex items-center justify-between h-14">
          <NavLink to="/" className="font-serif font-bold text-[0.95rem] text-accent tracking-[0.02em] transition-opacity hover:opacity-75">פלטפורמת חיפוש עבודה</NavLink>
          <div className="flex gap-[0.15rem]">
            <NavLink to="/" end className={({ isActive }) => `relative py-[0.45rem] px-4 rounded-lg text-[0.82rem] font-medium transition-all ${isActive ? 'text-accent bg-accent-muted' : 'text-text-dim hover:text-text-primary hover:bg-accent-muted'}`}>בית</NavLink>
            <NavLink to="/discovery" className={({ isActive }) => `relative py-[0.45rem] px-4 rounded-lg text-[0.82rem] font-medium transition-all ${isActive ? 'text-accent bg-accent-muted' : 'text-text-dim hover:text-text-primary hover:bg-accent-muted'}`}>גילוי משרות</NavLink>
            <NavLink to="/tracker" className={({ isActive }) => `relative py-[0.45rem] px-4 rounded-lg text-[0.82rem] font-medium transition-all ${isActive ? 'text-accent bg-accent-muted' : 'text-text-dim hover:text-text-primary hover:bg-accent-muted'}`}>מעקב</NavLink>
            <NavLink to="/settings" className={({ isActive }) => `relative py-[0.45rem] px-4 rounded-lg text-[0.82rem] font-medium transition-all ${isActive ? 'text-accent bg-accent-muted' : 'text-text-dim hover:text-text-primary hover:bg-accent-muted'}`}>הגדרות</NavLink>
          </div>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
