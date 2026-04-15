import { NavLink, Outlet } from 'react-router-dom';

export default function App() {
  return (
    <div className="app-shell">
      <nav className="app-nav">
        <div className="app-nav__inner">
          <NavLink to="/" className="app-nav__brand">פלטפורמת חיפוש עבודה</NavLink>
          <div className="app-nav__links">
            <NavLink to="/" end className={({ isActive }) => `app-nav__link${isActive ? ' active' : ''}`}>בית</NavLink>
            <NavLink to="/match" className={({ isActive }) => `app-nav__link${isActive ? ' active' : ''}`}>התאמת משרות</NavLink>
            <NavLink to="/discovery" className={({ isActive }) => `app-nav__link${isActive ? ' active' : ''}`}>גילוי משרות</NavLink>
            <NavLink to="/tracker" className={({ isActive }) => `app-nav__link${isActive ? ' active' : ''}`}>מעקב</NavLink>
            <NavLink to="/settings" className={({ isActive }) => `app-nav__link${isActive ? ' active' : ''}`}>הגדרות</NavLink>
          </div>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
