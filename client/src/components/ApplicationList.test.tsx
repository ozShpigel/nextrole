import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { api } from '../lib/api';
import ApplicationList from './ApplicationList';

vi.mock('../lib/api', () => ({
  api: vi.fn(),
}));

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
