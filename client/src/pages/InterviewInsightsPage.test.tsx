import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { api } from '../lib/api';
import InterviewInsightsPage from './InterviewInsightsPage';
import type { InterviewRetroListItem, InterviewInsightResponse } from '../lib/types';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

const retro: InterviewRetroListItem = {
  interview: {
    id: 'int-1',
    applicationId: 'app-1',
    type: 'Technical',
    scheduledAt: new Date('2026-01-15T10:00:00Z').toISOString(),
    completed: true,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    retroRating: 4,
    retroWentWell: 'Explained the system design clearly',
    retroToImprove: 'Struggled to estimate scale',
    retroCategories: ['Technical'],
  },
  applicationId: 'app-1',
  company: 'Acme Corp',
  jobTitle: 'Backend Engineer',
};

const noInsight: InterviewInsightResponse = { insight: null, newRetroCount: 0, totalRetroCount: 1, insufficientData: true };

function mockApi(overrides: { retros?: unknown; insight?: InterviewInsightResponse }) {
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/interview-insights/retros') return Promise.resolve(overrides.retros ?? [retro]);
    if (path === '/interview-insights') return Promise.resolve(overrides.insight ?? noInsight);
    return Promise.reject(new Error(`unexpected path in test: ${path}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InterviewInsightsPage', () => {
  it('renders the retro log from the retros query', async () => {
    mockApi({});
    renderWithRouter(<InterviewInsightsPage />);

    await waitFor(() => expect(screen.getByText(/Technical.*Acme Corp/)).toBeInTheDocument());
    expect(screen.getByText(/Explained the system design clearly/)).toBeInTheDocument();
    expect(screen.getByText(/Struggled to estimate scale/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no retros yet', async () => {
    mockApi({ retros: [] });
    renderWithRouter(<InterviewInsightsPage />);

    await waitFor(() => expect(screen.getByText(/No retros yet/)).toBeInTheDocument());
  });

  it('shows the insufficient-data message and disables the button below 2 retros', async () => {
    mockApi({ insight: { insight: null, newRetroCount: 0, totalRetroCount: 1, insufficientData: true } });
    renderWithRouter(<InterviewInsightsPage />);

    expect(await screen.findByText(/Not enough retros yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate insight/i })).toBeDisabled();
  });

  it('shows "No insight yet" with an enabled button once there are enough retros', async () => {
    mockApi({ insight: { insight: null, newRetroCount: 0, totalRetroCount: 2, insufficientData: false } });
    renderWithRouter(<InterviewInsightsPage />);

    expect(await screen.findByText('No insight yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate insight/i })).toBeEnabled();
  });

  it('shows a persisted insight with its meta line and a staleness nudge', async () => {
    mockApi({
      insight: {
        insight: { summary: 'You keep struggling with scale estimation.', generatedAt: '2026-01-10T00:00:00Z', retroCount: 3 },
        newRetroCount: 2,
        totalRetroCount: 5,
        insufficientData: false,
      },
    });
    renderWithRouter(<InterviewInsightsPage />);

    expect(await screen.findByText('You keep struggling with scale estimation.')).toBeInTheDocument();
    expect(screen.getByText(/Generated from 3 retros/)).toBeInTheDocument();
    expect(screen.getByText(/2 new retros since this insight/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('Refresh regenerates and the new summary replaces the old one', async () => {
    mockApi({
      insight: {
        insight: { summary: 'Old summary.', generatedAt: '2026-01-10T00:00:00Z', retroCount: 2 },
        newRetroCount: 1,
        totalRetroCount: 3,
        insufficientData: false,
      },
    });
    renderWithRouter(<InterviewInsightsPage />);
    expect(await screen.findByText('Old summary.')).toBeInTheDocument();

    let resolveSynthesize: (v: InterviewInsightResponse) => void = () => {};
    vi.mocked(api).mockImplementationOnce(() => new Promise((resolve) => { resolveSynthesize = resolve as (v: InterviewInsightResponse) => void; }));

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    resolveSynthesize({
      insight: { summary: 'Fresh summary.', generatedAt: '2026-01-20T00:00:00Z', retroCount: 3 },
      newRetroCount: 0,
      totalRetroCount: 3,
      insufficientData: false,
    });

    expect(await screen.findByText('Fresh summary.')).toBeInTheDocument();
    expect(screen.queryByText('Old summary.')).not.toBeInTheDocument();
    expect(screen.queryByText(/new retro/)).not.toBeInTheDocument();

    const synthesizeCall = vi.mocked(api).mock.calls.find(([path]) => path === '/interview-insights/synthesize');
    expect(synthesizeCall).toBeDefined();
    expect((synthesizeCall![1] as RequestInit).method).toBe('POST');
  });

  it('shows an error message when generation fails', async () => {
    mockApi({ insight: { insight: null, newRetroCount: 0, totalRetroCount: 2, insufficientData: false } });
    renderWithRouter(<InterviewInsightsPage />);
    expect(await screen.findByText('No insight yet.')).toBeInTheDocument();

    vi.mocked(api).mockImplementationOnce(() => Promise.reject(new Error('boom')));
    await userEvent.click(screen.getByRole('button', { name: /generate insight/i }));

    expect(await screen.findByText('Could not generate the insight')).toBeInTheDocument();
  });
});
