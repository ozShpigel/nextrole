import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/landing.css';

const services = [
  {
    name: 'גילוי משרות',
    description: 'סריקה אוטומטית של משרות מ-LinkedIn עם דירוג והתאמה באמצעות AI.',
    path: '/discovery',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="21" y1="21" x2="28" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="14" cy="14" r="4" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15"/>
      </svg>
    ),
    accent: 'var(--landing-accent-primary)',
  },
  {
    name: 'מעקב מועמדויות',
    description: 'מעקב אחר מועמדויות לעבודה, ראיונות ועדכוני סטטוס.',
    path: '/tracker',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="4" y="6" width="24" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="4" y1="12" x2="28" y2="12" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
        <circle cx="10" cy="18" r="1.5" fill="currentColor" opacity="0.5"/>
        <line x1="14" y1="18" x2="24" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
        <circle cx="10" cy="22.5" r="1.5" fill="currentColor" opacity="0.5"/>
        <line x1="14" y1="22.5" x2="20" y2="22.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
      </svg>
    ),
    accent: 'var(--landing-accent-secondary)',
  },
  {
    name: 'הגדרות',
    description: 'צפייה ועריכה של הפרופיל המקצועי ונתוני הקלט לניתוח Claude.',
    path: '/settings',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <circle cx="16" cy="16" r="4" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15"/>
        <line x1="16" y1="2" x2="16" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="16" y1="25" x2="16" y2="30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="2" y1="16" x2="7" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="25" y1="16" x2="30" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    accent: 'var(--landing-accent-secondary)',
  },
];

export default function Landing() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLoaded(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={`landing ${loaded ? 'landing--loaded' : ''}`}>
      <div className="landing-bg-grain" />
      <div className="landing-bg-glow landing-bg-glow--1" />
      <div className="landing-bg-glow landing-bg-glow--2" />
      <div className="landing-geo landing-geo--1" />
      <div className="landing-geo landing-geo--2" />
      <div className="landing-geo landing-geo--3" />

      <header className="landing-header">
        <div className="landing-header__badge">v0.1.0</div>
        <h1 className="landing-header__title">
          <span className="landing-header__title-line">פלטפורמת</span>
          <span className="landing-header__title-line landing-header__title-line--accent">חיפוש עבודה</span>
        </h1>
        <p className="landing-header__sub">ערכת כלים חכמה לניהול חיפוש העבודה שלך — מונעת בינה מלאכותית</p>
        <div className="landing-header__rule" />
      </header>

      <main className="landing-cards">
        {services.map((svc, i) => (
          <Link
            key={svc.name}
            to={svc.path}
            className="landing-card"
            style={{ '--i': i, '--card-accent': svc.accent }}
          >
            <div className="landing-card__icon">{svc.icon}</div>
            <div className="landing-card__body">
              <h2 className="landing-card__title">{svc.name}</h2>
              <p className="landing-card__desc">{svc.description}</p>
            </div>
            <div className="landing-card__arrow">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </Link>
        ))}
      </main>

      <footer className="landing-footer">
        <span>&copy; 2026 פלטפורמת חיפוש עבודה</span>
      </footer>
    </div>
  );
}
