import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import { discoveryApi } from '../lib/api';
import DiscoveryPage from './DiscoveryPage';

vi.mock('../lib/api', () => ({
  discoveryApi: vi.fn(),
}));

vi.mock('../components/CriteriaPanel', () => ({
  CriteriaForm: () => <div data-testid="criteria-form">Form</div>,
  CriteriaSection: ({ criteria }: any) => <div data-testid="criteria-section">{criteria.length} criteria</div>,
}));
vi.mock('../components/DiscoveryLoadingSkeleton', () => ({ default: () => <div data-testid="loading-skeleton">Loading...</div> }));
vi.mock('../components/PageHeader', () => ({ default: () => <div data-testid="page-header">Header</div> }));
vi.mock('../components/Stats', () => ({ StatStrip: () => <div data-testid="stat-strip">Stats</div> }));
vi.mock('../components/Error', () => ({ ErrorBanner: ({ error }: any) => <div data-testid="error-banner">{error}</div> }));
vi.mock('../components/RunsTimeline', () => ({ RunsTimeline: () => <div data-testid="runs-timeline">Timeline</div> }));
vi.mock('../components/WakeUpIndicator', () => ({ default: () => <div data-testid="wake-up">Waking up</div> }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DiscoveryPage', () => {
  it('shows loading skeleton while fetching data', () => {
    // Never resolve so we stay in loading state
    vi.mocked(discoveryApi).mockReturnValue(new Promise(() => {}));

    renderWithRouter(<DiscoveryPage />);

    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('renders page content after successful data load', async () => {
    const mockCriteria = [{ id: '1', title: 'React dev' }, { id: '2', title: 'Node dev' }];
    const mockRuns = [{ id: 'r1', status: 'done', started_at: '2026-05-01T00:00:00Z' }];

    vi.mocked(discoveryApi)
      .mockResolvedValueOnce({}) // /health
      .mockResolvedValueOnce(mockCriteria) // /criteria
      .mockResolvedValueOnce(mockRuns); // /runs

    renderWithRouter(<DiscoveryPage />);

    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeInTheDocument();
    });

    expect(screen.getByTestId('stat-strip')).toBeInTheDocument();
    expect(screen.getByTestId('criteria-section')).toHaveTextContent('2 criteria');
    expect(screen.getByTestId('runs-timeline')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
  });

  it('shows error banner when API call fails', async () => {
    vi.mocked(discoveryApi)
      .mockResolvedValueOnce({}) // /health succeeds
      .mockRejectedValue(new Error('Service unavailable')); // criteria/runs fail

    renderWithRouter(<DiscoveryPage />);

    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeInTheDocument();
    });

    expect(screen.getByTestId('error-banner')).toHaveTextContent('Service unavailable');
  });
});
