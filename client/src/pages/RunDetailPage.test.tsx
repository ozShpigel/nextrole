import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import { discoveryApi, matchApi } from '../lib/api';
import RunDetail from './RunDetailPage';

vi.mock('../lib/api', () => ({
  discoveryApi: vi.fn(),
  matchApi: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ runId: 'run-1' }) };
});

vi.mock('../components/Snapshots', () => ({
  SnapshotsModal: () => <div data-testid="snapshots-modal" />,
}));

const mockRun = {
  id: 'run-1',
  criteria_name: 'React Developer Search',
  status: 'completed',
  jobs_scraped: 25,
  jobs_scored: 20,
  jobs_saved: 5,
  jobs_skipped_duplicate: 3,
};

const mockJobs = [
  {
    id: 'j1',
    title: 'Frontend Engineer',
    company: 'TechCo',
    location: 'Remote',
    score: 92,
    verdict: 'STRONG_YES',
    key_strengths: ['React', 'TypeScript'],
    key_concerns: [],
    honest_assessment: 'Great match',
    saved_to_tracker: false,
    dismissed: false,
    is_duplicate: false,
  },
  {
    id: 'j2',
    title: 'Full Stack Developer',
    company: 'StartupInc',
    score: 65,
    verdict: 'MAYBE',
    key_strengths: ['Node.js'],
    key_concerns: ['No React experience required'],
    saved_to_tracker: true,
    dismissed: false,
    is_duplicate: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RunDetailPage', () => {
  it('shows loading skeleton while fetching data', () => {
    vi.mocked(discoveryApi).mockReturnValue(new Promise(() => {}));

    renderWithRouter(<RunDetail />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading run details')).toBeInTheDocument();
  });

  it('renders run details and jobs after successful load', async () => {
    vi.mocked(discoveryApi)
      .mockResolvedValueOnce(mockRun)
      .mockResolvedValueOnce(mockJobs);

    renderWithRouter(<RunDetail />);

    await waitFor(() => {
      expect(screen.getByText('React Developer Search')).toBeInTheDocument();
    });

    expect(screen.getByText('Scraped: 25')).toBeInTheDocument();
    expect(screen.getByText('Scored: 20')).toBeInTheDocument();
    expect(screen.getByText('Saved: 5')).toBeInTheDocument();
    expect(screen.getByText('Duplicates: 3')).toBeInTheDocument();

    expect(screen.getByText('Frontend Engineer')).toBeInTheDocument();
    expect(screen.getByText('TechCo')).toBeInTheDocument();
    expect(screen.getByText('Full Stack Developer')).toBeInTheDocument();
    expect(screen.getByText('StartupInc')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    vi.mocked(discoveryApi).mockRejectedValue(new Error('Network error'));

    renderWithRouter(<RunDetail />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows back link to discovery page', async () => {
    vi.mocked(discoveryApi)
      .mockResolvedValueOnce(mockRun)
      .mockResolvedValueOnce(mockJobs);

    renderWithRouter(<RunDetail />);

    await waitFor(() => {
      expect(screen.getByText('React Developer Search')).toBeInTheDocument();
    });

    const backLink = screen.getByText(/Back to Job Discovery/);
    expect(backLink).toBeInTheDocument();
    expect(backLink.closest('a')).toHaveAttribute('href', '/discovery');
  });

  it('shows "No jobs found" when run has no visible jobs', async () => {
    vi.mocked(discoveryApi)
      .mockResolvedValueOnce(mockRun)
      .mockResolvedValueOnce([]);

    renderWithRouter(<RunDetail />);

    await waitFor(() => {
      expect(screen.getByText('No jobs found')).toBeInTheDocument();
    });
  });
});
