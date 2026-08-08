import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { api } from '../lib/api';
import ApplicationList from './ApplicationList';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: vi.fn() };
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

function makeApps() {
  const base = { matchScore: 70, matchVerdict: 'YES', nextInterviewAt: null };
  return [
    { ...base, id: 'm1', jobTitle: 'Motion Role', company: 'MotionCo', status: 'TechnicalInterview', createdAt: daysAgo(5), updatedAt: daysAgo(1) },
    { ...base, id: 't1', jobTitle: 'Queue Role A', company: 'QueueCo A', status: 'Analyzing', createdAt: daysAgo(2), updatedAt: daysAgo(2) },
    { ...base, id: 't2', jobTitle: 'Queue Role B', company: 'QueueCo B', status: 'DecidedToApply', createdAt: daysAgo(1), updatedAt: daysAgo(1) },
    // 8 fresh Applied — enough to trigger the 6-row cap. Applied N days ago = N.
    ...Array.from({ length: 8 }, (_, i) => ({
      ...base,
      id: `a${i + 1}`,
      jobTitle: `Applied Role ${i + 1}`,
      company: `AppliedCo ${i + 1}`,
      status: 'Applied',
      createdAt: daysAgo(i + 1),
      updatedAt: daysAgo(i + 1),
    })),
    { ...base, id: 'g1', jobTitle: 'Ghosted Role 1', company: 'GhostCo 1', status: 'Applied', createdAt: daysAgo(40), updatedAt: daysAgo(35) },
    { ...base, id: 'g2', jobTitle: 'Ghosted Role 2', company: 'GhostCo 2', status: 'Applied', createdAt: daysAgo(50), updatedAt: daysAgo(45) },
    { ...base, id: 'r1', jobTitle: 'Closed Role', company: 'ClosedCo', status: 'Rejected', createdAt: daysAgo(20), updatedAt: daysAgo(10) },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue(makeApps());
});

async function renderList() {
  renderWithRouter(<ApplicationList />);
  await waitFor(() => expect(screen.getByText('Motion Role')).toBeInTheDocument());
}

describe('ApplicationList sections', () => {
  it('renders all four sections with their labels', async () => {
    await renderList();
    expect(screen.getByText('In Motion')).toBeInTheDocument();
    expect(screen.getByText('To Apply')).toBeInTheDocument();
    expect(screen.getByText('No Reply Yet')).toBeInTheDocument();
    expect(screen.getByText('The Archive')).toBeInTheDocument();
  });

  it('puts Analyzing and DecidedToApply under To Apply, not No Reply Yet', async () => {
    await renderList();
    const toApply = screen.getByRole('region', { name: /applications to apply to/i });
    expect(within(toApply).getByText('Queue Role A')).toBeInTheDocument();
    expect(within(toApply).getByText('Queue Role B')).toBeInTheDocument();

    const awaiting = screen.getByRole('region', { name: /awaiting a reply/i });
    expect(within(awaiting).queryByText('Queue Role A')).not.toBeInTheDocument();
  });

  it('caps fresh Applied rows at 6 with a Show all toggle', async () => {
    await renderList();
    const awaiting = screen.getByRole('region', { name: /awaiting a reply/i });

    // Freshest first: roles 1..6 visible, 7 and 8 hidden behind the toggle.
    expect(within(awaiting).getByText('Applied Role 1')).toBeInTheDocument();
    expect(within(awaiting).getByText('Applied Role 6')).toBeInTheDocument();
    expect(within(awaiting).queryByText('Applied Role 7')).not.toBeInTheDocument();

    const toggle = within(awaiting).getByRole('button', { name: 'Show all (8)' });
    await userEvent.click(toggle);
    expect(within(awaiting).getByText('Applied Role 7')).toBeInTheDocument();
    expect(within(awaiting).getByText('Applied Role 8')).toBeInTheDocument();

    await userEvent.click(within(awaiting).getByRole('button', { name: 'Show fewer' }));
    expect(within(awaiting).queryByText('Applied Role 8')).not.toBeInTheDocument();
  });

  it('orders fresh Applied rows freshest first', async () => {
    await renderList();
    const awaiting = screen.getByRole('region', { name: /awaiting a reply/i });
    const titles = within(awaiting)
      .getAllByText(/^Applied Role \d$/)
      .map((el) => el.textContent);
    expect(titles).toEqual(['Applied Role 1', 'Applied Role 2', 'Applied Role 3', 'Applied Role 4', 'Applied Role 5', 'Applied Role 6']);
  });

  it('folds 30d+ silent Applied rows into a collapsed Probably ghosted group', async () => {
    await renderList();
    const awaiting = screen.getByRole('region', { name: /awaiting a reply/i });

    expect(within(awaiting).getByText('Probably ghosted')).toBeInTheDocument();
    // The section count reflects fresh rows only.
    expect(within(awaiting).getByText('· 8')).toBeInTheDocument();

    // <details> children exist in the DOM but the group is collapsed by default.
    const details = within(awaiting).getByText('Probably ghosted').closest('details')!;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Ghosted Role 1')).toBeInTheDocument();
    expect(within(details).getByText('Ghosted Role 2')).toBeInTheDocument();

    await userEvent.click(within(awaiting).getByText('Probably ghosted'));
    expect(details.open).toBe(true);
  });

  it('keeps Rejected in The Archive only', async () => {
    await renderList();
    const archiveDetails = screen.getByText('The Archive').closest('details')!;
    expect(within(archiveDetails).getByText('Closed Role')).toBeInTheDocument();
    const awaiting = screen.getByRole('region', { name: /awaiting a reply/i });
    expect(within(awaiting).queryByText('Closed Role')).not.toBeInTheDocument();
  });
});

describe('ApplicationList — résumé pack action (To Apply only)', () => {
  // Path/method-aware mock — the single generic mock above (any api() call
  // resolves the same list) isn't enough here since these tests also need
  // /config and /applications/{id}/pack to behave differently per call.
  function mockRoutes(routes: Record<string, unknown>) {
    vi.mocked(api).mockImplementation((path: string, options?: { method?: string }) => {
      const key = `${options?.method ?? 'GET'} ${path}`;
      if (key in routes) return Promise.resolve(routes[key]);
      throw new Error(`Unmocked api() call: ${key}`);
    });
  }

  const toApplyApp = {
    id: 't1', jobTitle: 'Queue Role', company: 'QueueCo', status: 'DecidedToApply',
    matchScore: 70, matchVerdict: 'YES', createdAt: daysAgo(1), updatedAt: daysAgo(1),
    nextInterviewAt: null, hasPack: false,
  };

  it('shows Generate Pack for a row without a pack, and flips to Review Pack once generated', async () => {
    const user = userEvent.setup();
    mockRoutes({
      'GET /config': { demoMode: false },
      'GET /applications': [toApplyApp],
      'POST /applications/t1/pack': {
        tailoredSummary: 'Tailored summary', experience: [], highlightedSkills: [],
        generatedAt: '2026-01-01T00:00:00Z',
      },
    });
    renderWithRouter(<ApplicationList />);
    await waitFor(() => expect(screen.getByText('Queue Role')).toBeInTheDocument());

    const generateBtn = screen.getByRole('button', { name: 'Generate résumé pack for QueueCo' });
    await user.click(generateBtn);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Review résumé pack for QueueCo' })).toBeInTheDocument(),
    );
  });

  it('disables Generate Pack with the demo title under DemoMode', async () => {
    mockRoutes({
      'GET /config': { demoMode: true },
      'GET /applications': [toApplyApp],
    });
    renderWithRouter(<ApplicationList />);
    await waitFor(() => expect(screen.getByText('Queue Role')).toBeInTheDocument());

    const generateBtn = await screen.findByRole('button', { name: 'Generate résumé pack for QueueCo' });
    expect(generateBtn).toBeDisabled();
    expect(generateBtn).toHaveAttribute('title', 'Disabled in the read-only demo');
  });

  it('opens the pack modal with the persisted content when Review Pack is clicked', async () => {
    const user = userEvent.setup();
    mockRoutes({
      'GET /config': { demoMode: false },
      'GET /applications': [{ ...toApplyApp, hasPack: true }],
      'GET /applications/t1/pack': {
        tailoredSummary: 'Grounded tailored summary',
        experience: [{ title: 'Engineer', company: 'Co', dates: '2020–2022', highlights: ['Did the thing'] }],
        highlightedSkills: ['TypeScript'],
        generatedAt: '2026-01-01T00:00:00Z',
      },
    });
    renderWithRouter(<ApplicationList />);
    await waitFor(() => expect(screen.getByText('Queue Role')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Review résumé pack for QueueCo' }));

    expect(await screen.findByText(/generated/i)).toBeInTheDocument();
    const embed = document.querySelector('embed[type="application/pdf"]');
    expect(embed).toBeInTheDocument();
    expect(embed).toHaveAttribute('src', expect.stringContaining('/applications/t1/pack/pdf'));
  });
});
