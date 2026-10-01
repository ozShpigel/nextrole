import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AboutPage from './AboutPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>,
  );
}

describe('AboutPage', () => {
  it('leads with what NextRole is', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: /an ai job search, from cv to offer/i })).toBeInTheDocument();
  });

  it('links every section in the bar to a heading on the page', () => {
    const { container } = renderPage();
    const bar = screen.getByRole('navigation', { name: /on this page/i });
    const links = bar.querySelectorAll('a[href^="#"]');
    expect(links.length).toBe(5);
    links.forEach((a) => {
      const id = a.getAttribute('href')!.slice(1);
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    });
  });

  it('shows who built it, with outside links opening in a new tab', () => {
    renderPage();
    const linkedin = screen.getByRole('link', { name: /linkedin/i });
    expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/in/ozshpigel');
    expect(linkedin).toHaveAttribute('target', '_blank');
    expect(linkedin).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
