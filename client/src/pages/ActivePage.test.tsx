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

function serve(
  features: Record<string, boolean>,
  apps: unknown[] = [ready],
  allowance = { limit: 3, used: 1, remaining: 2 },
) {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path === '/features') return features;
    if (path === '/applications') return apps;
    if (path === '/applications/allowance') return allowance;
    return {};
  });
}

beforeEach(() => vi.clearAllMocks());

describe('ActivePage — coming-soon features', () => {
  it('shows auto-update as on for a visitor who has it', async () => {
    serve({ AutoUpdate: true, AutoApply: false });
    renderWithRouter(<ActivePage />);

    expect(await screen.findByText(/auto-update on/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /auto update/i })).not.toBeInTheDocument();
  });

  it('shows auto apply and auto update as switches that stay off, to everyone else', async () => {
    serve({ AutoUpdate: false, AutoApply: false });
    renderWithRouter(<ActivePage />);

    const autoUpdate = await screen.findByRole('switch', { name: /auto update/i });
    const autoApply = screen.getByRole('switch', { name: /auto apply/i });
    for (const toggle of [autoUpdate, autoApply]) {
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(toggle).toHaveAttribute('aria-disabled', 'true');
    }
    expect(screen.queryByText(/auto-update on/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/currently unavailable/i)).not.toBeInTheDocument();

    // Pressing the switch only says so, quietly: nothing opens, nothing turns on.
    await userEvent.click(autoApply);
    expect(await screen.findByText(/currently unavailable/i)).toBeInTheDocument();
    expect(autoApply).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does nothing when the row itself is pressed', async () => {
    serve({ AutoUpdate: false, AutoApply: false });
    renderWithRouter(<ActivePage />);

    await userEvent.click(await screen.findByText(/applies to your saved roles/i));
    expect(screen.queryByText(/currently unavailable/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows how many jobs can still be added today', async () => {
    serve({ AutoUpdate: true, AutoApply: true });
    renderWithRouter(<ActivePage />);

    expect(await screen.findByText('2 saves left today')).toBeInTheDocument();
  });

  it('says so when none are left', async () => {
    serve({ AutoUpdate: true, AutoApply: true }, [ready], { limit: 3, used: 3, remaining: 0 });
    renderWithRouter(<ActivePage />);

    expect(await screen.findByText('No saves left today')).toBeInTheDocument();
  });

  it('offers Import Job only to a visitor with the feature', async () => {
    serve({ AutoUpdate: true, AutoApply: true, ImportJob: true });
    const { unmount } = renderWithRouter(<ActivePage />);
    expect(await screen.findByRole('button', { name: /import job/i })).toBeInTheDocument();
    unmount();

    serve({ AutoUpdate: true, AutoApply: true, ImportJob: false });
    renderWithRouter(<ActivePage />);
    await screen.findByText(/auto-update on/i);
    expect(screen.queryByRole('button', { name: /import job/i })).not.toBeInTheDocument();
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

describe('ActivePage — archived', () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const applied = (id: string, company: string, days: number) => ({
    id, jobTitle: 'Platform Engineer', company, status: 'Applied', hasPack: true,
    matchScore: 70, matchVerdict: 'apply', jobUrl: null,
    createdAt: daysAgo(days), updatedAt: daysAgo(days), appliedAt: daysAgo(days),
  });

  it('keeps a stale application out of the Applied column, in its own section below the board', async () => {
    serve({ AutoUpdate: true, AutoApply: true }, [applied('a-fresh', 'Freshco', 2), applied('a-stale', 'Staleco', 30)]);
    renderWithRouter(<ActivePage />);

    const archived = await screen.findByText('Archived');
    const section = archived.closest('details')!;
    expect(within(section).getByText(/Staleco/)).toBeInTheDocument();
    expect(within(section).queryByText(/Freshco/)).not.toBeInTheDocument();
    // The section sits below the board, not inside a column, and no Applied
    // column (desktop grid or mobile tab) holds the stale card.
    expect(section.closest('[role="region"]')).toBeNull();
    for (const column of screen.getAllByRole('region', { name: 'Applied' })) {
      expect(within(column).getByText(/Freshco/)).toBeInTheDocument();
      expect(within(column).queryByText(/Staleco/)).not.toBeInTheDocument();
    }
  });

  it('shows no archived section when nothing is stale', async () => {
    serve({ AutoUpdate: true, AutoApply: true }, [applied('a-fresh', 'Freshco', 2)]);
    renderWithRouter(<ActivePage />);

    expect((await screen.findAllByText(/Freshco/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });
});
