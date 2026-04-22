import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/landing.css';

const services = [
  {
    name: 'גילוי משרות',
    description: 'סריקה אוטומטית של משרות מ-LinkedIn עם דירוג והתאמה באמצעות AI.',
    path: '/discovery',
    kicker: 'Discovery',
    icon: (
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
        <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="21" y1="21" x2="28" y2="28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    name: 'מעקב מועמדויות',
    description: 'מעקב אחר מועמדויות לעבודה, ראיונות ועדכוני סטטוס.',
    path: '/tracker',
    kicker: 'Tracking',
    icon: (
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
        <rect x="5" y="6" width="22" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="5" y1="12" x2="27" y2="12" stroke="currentColor" strokeWidth="1.5" opacity="0.55"/>
        <line x1="10" y1="18" x2="22" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45"/>
        <line x1="10" y1="22" x2="18" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45"/>
      </svg>
    ),
  },
  {
    name: 'הגדרות',
    description: 'צפייה ועריכה של הפרופיל המקצועי ונתוני הקלט לניתוח Claude.',
    path: '/settings',
    kicker: 'Configuration',
    icon: (
      <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <circle cx="16" cy="16" r="3" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <line x1="16" y1="3" x2="16" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="16" y1="25" x2="16" y2="29" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="3" y1="16" x2="7" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="25" y1="16" x2="29" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
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
      <div className="landing-bg-grain" aria-hidden="true" />
      <div className="landing-bg-glow landing-bg-glow--1" aria-hidden="true" />
      <div className="landing-bg-glow landing-bg-glow--2" aria-hidden="true" />

      {/* Editorial crop marks at viewport corners */}
      <div className="landing-marks" aria-hidden="true">
        <span className="landing-marks__mark landing-marks__mark--tl" />
        <span className="landing-marks__mark landing-marks__mark--tr" />
        <span className="landing-marks__mark landing-marks__mark--bl" />
        <span className="landing-marks__mark landing-marks__mark--br" />
      </div>

      <header className="landing-header">
        <div className="landing-header__edition" dir="ltr">
          <span className="landing-header__edition-dot" aria-hidden="true">●</span>
          <span className="landing-header__edition-text">V 0.1.0 &nbsp;·&nbsp; VOL. 01 &nbsp;·&nbsp; MMXXVI</span>
          <span className="landing-header__edition-dot" aria-hidden="true">●</span>
        </div>

        <h1 className="landing-header__title">
          <span className="landing-header__title-pre">— פלטפורמת —</span>
          <span className="landing-header__title-main">
            <span className="landing-header__title-word">חיפוש</span>
            <span className="landing-header__title-word landing-header__title-word--accent">עבודה</span>
          </span>
        </h1>

        <p className="landing-header__sub">
          ערכת כלים חכמה לניהול חיפוש העבודה —<br />
          <em>מונעת בינה מלאכותית, בעיצוב מוקפד.</em>
        </p>

        <div className="landing-header__ornament" aria-hidden="true">
          <span className="landing-header__ornament-dot" />
          <span className="landing-header__ornament-bar" />
          <span className="landing-header__ornament-diamond" />
          <span className="landing-header__ornament-bar" />
          <span className="landing-header__ornament-dot" />
        </div>
      </header>

      <div className="landing-toc" aria-hidden="true">
        <span className="landing-toc__rule" />
        <span className="landing-toc__label">Contents · תוכן העניינים</span>
        <span className="landing-toc__rule" />
      </div>

      <main className="landing-cards">
        {services.map((svc, i) => (
          <Link
            key={svc.name}
            to={svc.path}
            className="landing-card"
            style={{ '--i': i }}
            aria-label={`${svc.name} — ${svc.description}`}
          >
            <div className="landing-card__top">
              <span className="landing-card__num">{String(i + 1).padStart(2, '0')}</span>
              <span className="landing-card__kicker" dir="ltr">{svc.kicker}</span>
            </div>

            <div className="landing-card__body">
              <h2 className="landing-card__title">{svc.name}</h2>
              <span className="landing-card__rule" aria-hidden="true" />
              <p className="landing-card__desc">{svc.description}</p>
            </div>

            <div className="landing-card__foot">
              <span className="landing-card__icon" aria-hidden="true">{svc.icon}</span>
              <span className="landing-card__cta">
                <span className="landing-card__cta-text">המשך לקריאה</span>
                <span className="landing-card__arrow" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                    <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
              </span>
            </div>

            <span className="landing-card__corner" aria-hidden="true" />
          </Link>
        ))}
      </main>

      <footer className="landing-footer">
        <span className="landing-footer__mono" dir="ltr" aria-hidden="true">
          <span className="landing-footer__mono-dot">·</span>
          J<span className="landing-footer__mono-dim">P</span>A
          <span className="landing-footer__mono-dot">·</span>
        </span>
        <span className="landing-footer__text">
          &copy; 2026 · פלטפורמת חיפוש עבודה · Crafted with care
        </span>
      </footer>
    </div>
  );
}
