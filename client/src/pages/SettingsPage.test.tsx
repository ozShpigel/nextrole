import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { matchApi } from '../lib/api';
import SettingsPage from './SettingsPage';

vi.mock('../lib/api', () => ({
  matchApi: vi.fn(),
}));

const mockProfileResponse = {
  content: '<professional_profile>…</professional_profile>',
  structured: {
    summary: 'Senior engineer.',
    seniority: 'Senior',
    domains: ['fintech'],
    experience: [{ title: 'Senior Software Engineer', company: 'Lumen Retail', dates: '2021–Present', highlights: ['Led checkout platform'] }],
    skills: { languages: ['TypeScript'], frameworks: ['React'], infrastructure: ['AWS'], databases: ['PostgreSQL'], other: [] },
    strengths: ['Clear communication'],
    coreValues: ['Sustainable pace'],
    rawExperienceText: 'Senior engineer, 9 years…',
  },
  updated_at: '2026-05-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SettingsPage', () => {
  it('shows loading skeleton initially', () => {
    // Never resolve so we stay in loading state
    vi.mocked(matchApi).mockReturnValue(new Promise(() => {}));

    renderWithRouter(<SettingsPage />);

    expect(screen.getByRole('status', { name: /loading settings/i })).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders page content after successful data load', async () => {
    vi.mocked(matchApi).mockResolvedValue(mockProfileResponse);

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Professional Profile')).toBeInTheDocument();
    });

    // Structured profile editor: experience/skills (normalized) + manual fields.
    expect(screen.getByText('Experience & skills')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Normalize/i })).toBeInTheDocument();
    expect(screen.getByText('Strengths')).toBeInTheDocument();
    expect(screen.getByText('Core values')).toBeInTheDocument();

    // Prompts and scoring config are locked server configuration — not editable here.
    expect(screen.queryByText('Analyst Prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('Evaluator Prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('Analysis Config')).not.toBeInTheDocument();

    expect(screen.queryByRole('status', { name: /loading settings/i })).not.toBeInTheDocument();
  });

  it('parses an uploaded résumé into the experience fields', async () => {
    const normalized = {
      summary: 'Parsed from résumé.',
      seniority: 'Staff',
      domains: ['ai'],
      experience: [{ title: 'Parsed Role', company: 'NewCo', dates: '2020–2024', highlights: ['Did things'] }],
      skills: { languages: ['Rust'], frameworks: [], infrastructure: [], databases: [], other: [] },
    };
    // GET /profile loads the page; POST /profile/normalize-file returns the parsed profile.
    vi.mocked(matchApi).mockImplementation((path: string) =>
      Promise.resolve(path === '/profile/normalize-file' ? normalized : mockProfileResponse) as never,
    );

    renderWithRouter(<SettingsPage />);
    await waitFor(() => expect(screen.getByText('Professional Profile')).toBeInTheDocument());

    const file = new File(['resume bytes'], 'resume.pdf', { type: 'application/pdf' });
    const input = screen.getByTestId('resume-file-input') as HTMLInputElement;
    await userEvent.upload(input, file);

    // The upload posts to the file endpoint with a FormData body…
    await waitFor(() =>
      expect(vi.mocked(matchApi)).toHaveBeenCalledWith(
        '/profile/normalize-file',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
      ),
    );
    // …and the parsed experience populates the form.
    expect(await screen.findByDisplayValue('Parsed Role')).toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(matchApi).mockRejectedValueOnce(new Error('Network error'));

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
