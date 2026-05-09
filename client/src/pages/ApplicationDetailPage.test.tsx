import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import { api, matchApi } from '../lib/api';
import ApplicationDetail from './ApplicationDetailPage';

vi.mock('../lib/api', () => ({
  api: vi.fn(),
  matchApi: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'app-1' }) };
});

vi.mock('../components/Status', () => ({
  StatusBadge: ({ status }: any) => <span data-testid="status-badge">{status}</span>,
  StatusModal: () => <div data-testid="status-modal" />,
}));
vi.mock('../components/CollapsibleSection', () => ({
  default: ({ title, children }: any) => <div data-testid="collapsible">{title}{children}</div>,
}));
vi.mock('../components/Snapshots', () => ({
  SnapshotsCard: () => <div data-testid="snapshots-card" />,
}));
vi.mock('../components/AnalysisCard', () => ({
  default: () => <div data-testid="analysis-card" />,
}));
vi.mock('../components/IntroductionCard', () => ({
  default: () => <div data-testid="intro-card" />,
}));
vi.mock('../components/Timeline', () => ({
  default: () => <div data-testid="timeline" />,
}));
vi.mock('../components/Interviews', () => ({
  InterviewList: () => <div data-testid="interview-list" />,
  InterviewModal: () => <div data-testid="interview-modal" />,
}));
vi.mock('../components/Notes', () => ({
  NoteList: () => <div data-testid="note-list" />,
  NoteModal: () => <div data-testid="note-modal" />,
}));

const mockApplication = {
  id: 'app-1',
  jobTitle: 'Senior React Developer',
  company: 'Acme Corp',
  status: 'Applied',
  matchScore: 85,
  matchVerdict: 'STRONG_YES',
  matchAnalysis: null,
  jobDescription: 'Build amazing UIs',
  updatedAt: new Date().toISOString(),
  salary: null,
  companySummary: null,
  companyNews: null,
  glassdoorData: null,
  analystSnapshotInput: null,
  analystSnapshotOutput: null,
  evaluatorSnapshotInput: null,
  evaluatorSnapshotOutput: null,
};

const mockDetailData = {
  application: mockApplication,
  interviews: [],
  notes: [],
  statusUpdates: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ApplicationDetailPage', () => {
  it('shows loading skeleton while data is fetching', () => {
    vi.mocked(api).mockReturnValue(new Promise(() => {}));
    vi.mocked(matchApi).mockReturnValue(new Promise(() => {}));

    renderWithRouter(<ApplicationDetail />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading application details')).toBeInTheDocument();
  });

  it('renders application details after successful load', async () => {
    vi.mocked(api).mockResolvedValue(mockDetailData);
    vi.mocked(matchApi).mockResolvedValue({ elevator_pitch: '', professional_intro: '', extended_intro: '' });

    renderWithRouter(<ApplicationDetail />);

    await waitFor(() => {
      expect(screen.getByText('Senior React Developer')).toBeInTheDocument();
    });

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Applied');
  });

  it('renders action buttons', async () => {
    vi.mocked(api).mockResolvedValue(mockDetailData);
    vi.mocked(matchApi).mockResolvedValue({});

    renderWithRouter(<ApplicationDetail />);

    await waitFor(() => {
      expect(screen.getByText('Senior React Developer')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Update Status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Interview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('shows back link to tracker', async () => {
    vi.mocked(api).mockResolvedValue(mockDetailData);
    vi.mocked(matchApi).mockResolvedValue({});

    renderWithRouter(<ApplicationDetail />);

    await waitFor(() => {
      expect(screen.getByText('Senior React Developer')).toBeInTheDocument();
    });

    const backLink = screen.getByText(/Back to List/);
    expect(backLink).toBeInTheDocument();
    expect(backLink.closest('a')).toHaveAttribute('href', '/tracker');
  });

  it('renders timeline and collapsible sections', async () => {
    vi.mocked(api).mockResolvedValue(mockDetailData);
    vi.mocked(matchApi).mockResolvedValue({});

    renderWithRouter(<ApplicationDetail />);

    await waitFor(() => {
      expect(screen.getByText('Senior React Developer')).toBeInTheDocument();
    });

    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-card')).toBeInTheDocument();
  });
});
