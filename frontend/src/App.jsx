import { useState, useEffect } from 'react';

const services = [
  {
    name: 'שירות התאמת משרות',
    description:
      'ניתוח הזדמנויות עבודה ביחס לפרופיל המקצועי שלך באמצעות בינה מלאכותית.',
    path: 'https://job-match-service-latest.onrender.com/',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <path d="M16 2L28 9V23L16 30L4 23V9L16 2Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M16 12L22 15.5V22.5L16 26L10 22.5V15.5L16 12Z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.15"/>
        <circle cx="16" cy="18" r="2.5" fill="currentColor" opacity="0.6"/>
      </svg>
    ),
    accent: 'var(--accent-primary)',
  },
  {
    name: 'מעקב מועמדויות',
    description: 'מעקב אחר מועמדויות לעבודה, ראיונות ועדכוני סטטוס.',
    path: 'https://application-tracker-latest-b8l9.onrender.com/',
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
    accent: 'var(--accent-secondary)',
  },
];

export default function App() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLoaded(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <style>{cssText}</style>
      <div className={`page ${loaded ? 'page--loaded' : ''}`}>
        {/* Decorative background elements */}
        <div className="bg-grain" />
        <div className="bg-glow bg-glow--1" />
        <div className="bg-glow bg-glow--2" />
        <div className="geo geo--1" />
        <div className="geo geo--2" />
        <div className="geo geo--3" />

        <header className="header">
          <div className="header__badge">v0.1.0</div>
          <h1 className="header__title">
            <span className="header__title-line">פלטפורמת</span>
            <span className="header__title-line header__title-line--accent">חיפוש עבודה</span>
          </h1>
          <p className="header__sub">ערכת כלים חכמה לניהול חיפוש העבודה שלך — מונעת בינה מלאכותית</p>
          <div className="header__rule" />
        </header>

        <main className="cards">
          {services.map((svc, i) => (
            <a
              key={svc.name}
              href={svc.path}
              className="card"
              style={{ '--i': i, '--card-accent': svc.accent }}
            >
              <div className="card__icon">{svc.icon}</div>
              <div className="card__body">
                <h2 className="card__title">{svc.name}</h2>
                <p className="card__desc">{svc.description}</p>
              </div>
              <div className="card__arrow">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </a>
          ))}
        </main>

        <footer className="footer">
          <span>&copy; 2026 פלטפורמת חיפוש עבודה</span>
        </footer>
      </div>
    </>
  );
}

const cssText = `
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;700;900&family=Noto+Serif+Hebrew:wght@400;700&display=swap');

  :root {
    --bg-deep: #111010;
    --bg-surface: #1a1917;
    --bg-card: rgba(28, 27, 24, 0.65);
    --border-subtle: rgba(196, 167, 116, 0.12);
    --border-hover: rgba(196, 167, 116, 0.3);
    --text-primary: #ede8df;
    --text-secondary: #9a9486;
    --text-dim: #5e5a52;
    --accent-primary: #c4a774;
    --accent-secondary: #8fb5a3;
    --accent-glow: rgba(196, 167, 116, 0.08);
  }

  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  html { font-size: 16px; }

  body {
    background: var(--bg-deep);
    color: var(--text-primary);
    font-family: 'Heebo', 'Noto Sans Hebrew', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }

  /* ── Page ── */
  .page {
    position: relative;
    min-height: 100vh;
    direction: rtl;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem;
    isolation: isolate;
  }

  /* ── Background effects ── */
  .bg-grain {
    position: fixed;
    inset: 0;
    z-index: 0;
    opacity: 0.03;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 200px;
  }

  .bg-glow {
    position: fixed;
    border-radius: 50%;
    pointer-events: none;
    z-index: 0;
    filter: blur(100px);
  }
  .bg-glow--1 {
    width: 600px; height: 600px;
    top: -200px; right: -100px;
    background: radial-gradient(circle, rgba(196,167,116,0.07) 0%, transparent 70%);
  }
  .bg-glow--2 {
    width: 500px; height: 500px;
    bottom: -150px; left: -100px;
    background: radial-gradient(circle, rgba(143,181,163,0.05) 0%, transparent 70%);
  }

  /* ── Geometric decorations ── */
  .geo {
    position: fixed;
    pointer-events: none;
    z-index: 0;
    border: 1px solid var(--border-subtle);
    opacity: 0;
    transition: opacity 1.2s ease;
  }
  .page--loaded .geo { opacity: 1; }

  .geo--1 {
    width: 280px; height: 280px;
    top: 8%; left: 5%;
    transform: rotate(45deg);
    border-radius: 4px;
    transition-delay: 0.6s;
  }
  .geo--2 {
    width: 120px; height: 120px;
    bottom: 15%; right: 8%;
    border-radius: 50%;
    transition-delay: 0.9s;
  }
  .geo--3 {
    width: 0; height: 0;
    top: 20%; right: 12%;
    border: 1px solid transparent;
    border-left: 60px solid transparent;
    border-right: 60px solid transparent;
    border-bottom: 100px solid transparent;
    border-bottom-color: var(--border-subtle);
    background: none;
    transition-delay: 1.2s;
  }

  /* ── Header ── */
  .header {
    position: relative;
    z-index: 1;
    text-align: center;
    margin-top: clamp(3rem, 10vh, 7rem);
    margin-bottom: 4rem;
    opacity: 0;
    transform: translateY(24px);
    transition: opacity 0.8s ease, transform 0.8s ease;
  }
  .page--loaded .header {
    opacity: 1;
    transform: translateY(0);
  }

  .header__badge {
    display: inline-block;
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--accent-primary);
    border: 1px solid var(--border-subtle);
    padding: 0.25rem 0.85rem;
    border-radius: 100px;
    margin-bottom: 1.75rem;
    font-family: 'Noto Serif Hebrew', 'Heebo', serif;
  }

  .header__title {
    font-weight: 900;
    line-height: 1.1;
    margin: 0;
  }
  .header__title-line {
    display: block;
    font-size: clamp(2.2rem, 5vw, 3.8rem);
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }
  .header__title-line--accent {
    font-family: 'Noto Serif Hebrew', 'Heebo', serif;
    font-weight: 700;
    font-size: clamp(2.6rem, 6vw, 4.4rem);
    background: linear-gradient(135deg, var(--accent-primary) 0%, #d4bc8a 50%, var(--accent-secondary) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .header__sub {
    font-size: clamp(0.95rem, 1.5vw, 1.1rem);
    color: var(--text-secondary);
    margin-top: 1rem;
    font-weight: 300;
    max-width: 400px;
    margin-inline: auto;
    line-height: 1.7;
  }

  .header__rule {
    width: 48px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent-primary), transparent);
    margin: 2rem auto 0;
  }

  /* ── Cards ── */
  .cards {
    position: relative;
    z-index: 1;
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    justify-content: center;
    max-width: 820px;
    width: 100%;
  }

  .card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 1.25rem;
    width: 100%;
    max-width: 380px;
    padding: 1.75rem 2rem;
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    text-decoration: none;
    color: var(--text-primary);
    cursor: pointer;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1),
                border-color 0.35s ease,
                box-shadow 0.35s ease;

    /* Staggered entrance */
    opacity: 0;
    transform: translateY(32px);
    transition: opacity 0.7s ease calc(var(--i) * 0.15s + 0.3s),
                transform 0.7s cubic-bezier(0.22, 1, 0.36, 1) calc(var(--i) * 0.15s + 0.3s),
                border-color 0.35s ease,
                box-shadow 0.35s ease;
  }
  .page--loaded .card {
    opacity: 1;
    transform: translateY(0);
  }

  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 16px;
    background: radial-gradient(
      ellipse at top right,
      var(--accent-glow) 0%,
      transparent 60%
    );
    opacity: 0;
    transition: opacity 0.35s ease;
    pointer-events: none;
  }

  .card:hover {
    transform: translateY(-3px);
    border-color: var(--border-hover);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3),
                0 0 0 1px rgba(196, 167, 116, 0.05);
  }
  .card:hover::before { opacity: 1; }

  .card__icon {
    flex-shrink: 0;
    width: 52px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    background: rgba(196, 167, 116, 0.06);
    border: 1px solid var(--border-subtle);
    color: var(--card-accent);
    transition: background 0.3s ease, border-color 0.3s ease;
  }
  .card:hover .card__icon {
    background: rgba(196, 167, 116, 0.1);
    border-color: var(--border-hover);
  }

  .card__body { flex: 1; min-width: 0; }

  .card__title {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0 0 0.35rem;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .card__desc {
    font-size: 0.88rem;
    color: var(--text-secondary);
    line-height: 1.65;
    margin: 0;
  }

  .card__arrow {
    flex-shrink: 0;
    color: var(--text-dim);
    transition: color 0.3s ease, transform 0.3s ease;
  }
  .card:hover .card__arrow {
    color: var(--card-accent);
    transform: translateX(-4px);
  }

  /* ── Footer ── */
  .footer {
    position: relative;
    z-index: 1;
    margin-top: auto;
    padding-top: 4rem;
    color: var(--text-dim);
    font-size: 0.8rem;
    letter-spacing: 0.03em;
    opacity: 0;
    transition: opacity 1s ease 0.8s;
  }
  .page--loaded .footer { opacity: 1; }

  /* ── Responsive ── */
  @media (max-width: 540px) {
    .cards { gap: 1rem; }
    .card {
      max-width: 100%;
      padding: 1.25rem 1.5rem;
    }
    .geo { display: none; }
  }
`;
