import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { api } from '../lib/api';
import ActivePage from './ActivePage';

vi.mock('../lib/api', () => ({ api: vi.fn(), matchApi: vi.fn() }));

// A Ready card: decided to apply, pack built.
const ready = {
  id: 'app-1', jobTitle: 'Backend Engineer', company: 'Acme', status: 'DecidedToApply', hasPack: true,
  matchScore: 80, matchVerdict: 'apply', jobUrl: 'https://jobs.example.com/acme/1',
  createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z',
};

function serve(features: Record<string, boolean>, apps: unknown[] = [ready]) {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path === '/features') return features;
    if (path === '/applications') return apps;
    return {};
  });
}

beforeEach(() => vi.clearAllMocks());

describe('ActivePage — coming-soon features', () => {
  it('shows auto-update as on for a visitor who has it', async () => {
    serve({ AutoUpdate: true, AutoApply: false });
    renderWithRouter(<ActivePage />);

    expect(await screen.findByText(/auto-update on/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /auto-update/i })).not.toBeInTheDocument();
  });

  it('shows auto-update as a locked control to everyone else', async () => {
    serve({ AutoUpdate: false, AutoApply: false });
    renderWithRouter(<ActivePage />);

    const locked = await screen.findByRole('button', { name: /auto-update/i });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText(/auto-update on/i)).not.toBeInTheDocument();
  });

  it('gives a Ready card the job site, a plain mark-as-applied, and a locked one-click apply', async () => {
    serve({ AutoUpdate: false, AutoApply: false });
    renderWithRouter(<ActivePage />);

    // By text, not by role: the whole card is itself role="link" (it opens the
    // application), and its name contains every label inside it.
    const site = (await screen.findAllByText(/apply on job site/i))[0].closest('a')!;
    expect(site).toHaveAttribute('href', ready.jobUrl);
    expect(site).toHaveAttribute('target', '_blank');
    expect(site).toHaveAttribute('rel', 'noopener noreferrer');

    const card = site.closest('[role="link"]') as HTMLElement;
    expect(within(card).getByRole('button', { name: /mark as applied/i })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /one-click apply/i })).toHaveAttribute('aria-disabled', 'true');
    // The old label read as though NextRole had sent the application.
    expect(screen.queryByText(/i applied/i)).not.toBeInTheDocument();
  });

  it('keeps the visitor on the board when the locked control is used by click or by Enter', async () => {
    serve({ AutoUpdate: false, AutoApply: false });
    renderWithRouter(<ActivePage />);
    const start = window.location.pathname;

    const locked = (await screen.findAllByRole('button', { name: /one-click apply/i }))[0];
    await userEvent.click(locked);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');

    // The card itself opens the application; neither the click nor an Enter
    // inside the dialog may reach it.
    expect(window.location.pathname).toBe(start);
  });

  it('offers no job-site link when the job has no real URL', async () => {
    serve({ AutoUpdate: false, AutoApply: false }, [{ ...ready, jobUrl: null }]);
    renderWithRouter(<ActivePage />);

    expect((await screen.findAllByRole('button', { name: /mark as applied/i })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/apply on job site/i)).not.toBeInTheDocument();
  });
});
