import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { matchApi } from '../lib/api';
import SettingsPage from './SettingsPage';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, matchApi: vi.fn() };
});

const mockProfileResponse = {
  content: '<professional_profile>…</professional_profile>',
  structured: {
    fullName: '', email: '', phone: '', location: '',
    summary: 'Senior engineer.',
    seniority: 'Senior',
    domains: ['fintech'],
    experience: [{ title: 'Senior Software Engineer', company: 'Lumen Retail', dates: '2021–Present', highlights: ['Led checkout platform'] }],
    skills: { languages: ['TypeScript'], frameworks: ['React'], infrastructure: ['AWS'], databases: ['PostgreSQL'], other: [] },
    education: [],
    strengths: ['Clear communication'],
    coreValues: ['Sustainable pace'],
    rawExperienceText: 'Senior engineer, 9 years…',
  },
  updated_at: '2026-05-01T00:00:00Z',
};

const NO_RESUME_FILE_ERROR = Object.assign(new Error('Not Found'), { status: 404 });

// Path/method-aware mock — different tests need /profile, /profile/resume-file,
// PUT /profile, and the normalize endpoints to behave independently.
function mockRoutes(routes: Record<string, unknown>) {
  vi.mocked(matchApi).mockImplementation((path: string, options?: { method?: string }) => {
    const key = `${options?.method ?? 'GET'} ${path}`;
    if (key in routes) {
      const value = routes[key];
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve(value);
    }
    return Promise.reject(new Error(`Unmocked matchApi() call: ${key}`));
  });
}

// The sidebar tab label and the content-pane heading share the same text
// ("About You" / "Resume"), so tests disambiguate via role: the tab is a
// button, the content header is an <h1>.
async function gotoResumeTab(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /resume/i }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Resume' })).toBeInTheDocument());
}

async function gotoValuesTab(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /work values/i }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Work Values' })).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SettingsPage', () => {
  it('shows loading skeleton initially', () => {
    mockRoutes({}); // never resolves the routes it needs -> stays loading
    vi.mocked(matchApi).mockReturnValue(new Promise(() => {}));

    renderWithRouter(<SettingsPage />);

    expect(screen.getByRole('status', { name: /loading profile/i })).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders the About You tab by default, with no field editor and no Save button', async () => {
    mockRoutes({
      'GET /profile': mockProfileResponse,
      'GET /profile/resume-file': NO_RESUME_FILE_ERROR,
    });

    renderWithRouter(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'About You' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /work values/i })).toBeInTheDocument();
    // Strengths/Core values live under their own Work Values tab, not here.
    expect(screen.queryByText('Strengths')).not.toBeInTheDocument();
    expect(screen.queryByText('Core values')).not.toBeInTheDocument();

    // The old structured-field editor is gone.
    expect(screen.queryByText('Experience & skills')).not.toBeInTheDocument();
    expect(screen.queryByText('Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Skills')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save profile$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^history$/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Your candidate profile')).not.toBeInTheDocument();
    expect(screen.queryByText('The Standards Desk')).not.toBeInTheDocument();
  });

  it('the Resume tab shows the empty state until switched to', async () => {
    mockRoutes({
      'GET /profile': mockProfileResponse,
      'GET /profile/resume-file': NO_RESUME_FILE_ERROR,
    });
    const user = userEvent.setup();

    renderWithRouter(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'About You' })).toBeInTheDocument());
    expect(screen.queryByText('No résumé uploaded yet — use the button above.')).not.toBeInTheDocument();

    await gotoResumeTab(user);
    expect(screen.getByText('No résumé uploaded yet — use the button above.')).toBeInTheDocument();
  });

  it('editing a contact row auto-saves without a Save button', async () => {
    const user = userEvent.setup();
    mockRoutes({
      'GET /profile': mockProfileResponse,
      'GET /profile/resume-file': NO_RESUME_FILE_ERROR,
      'PUT /profile': { ...mockProfileResponse, structured: { ...mockProfileResponse.structured, fullName: 'Jamie Dev' } },
    });

    renderWithRouter(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'About You' })).toBeInTheDocument());

    const fullNameRow = screen.getByText('Full name').closest('div')!;
    await user.click(within(fullNameRow).getByRole('button'));
    const input = within(fullNameRow).getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Jamie Dev');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(vi.mocked(matchApi)).toHaveBeenCalledWith(
        '/profile',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"fullName":"Jamie Dev"'),
        }),
      ),
    );
    // Shows in both the contact row and the sidebar profile card.
    expect(await screen.findAllByText('Jamie Dev')).toHaveLength(2);
  });

  it('the Work Values tab shows Strengths and Core values', async () => {
    mockRoutes({
      'GET /profile': mockProfileResponse,
      'GET /profile/resume-file': NO_RESUME_FILE_ERROR,
    });
    const user = userEvent.setup();

    renderWithRouter(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'About You' })).toBeInTheDocument());
    await gotoValuesTab(user);

    expect(screen.getByText('Strengths')).toBeInTheDocument();
    expect(screen.getByText('Core values')).toBeInTheDocument();
  });

  it('adding a Strengths chip auto-saves', async () => {
    const user = userEvent.setup();
    mockRoutes({
      'GET /profile': mockProfileResponse,
      'GET /profile/resume-file': NO_RESUME_FILE_ERROR,
      'PUT /profile': mockProfileResponse,
    });

    renderWithRouter(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'About You' })).toBeInTheDocument());
    await gotoValuesTab(user);

    await user.type(screen.getByLabelText('Add a core value'), 'Ownership{Enter}');

    await waitFor(() =>
      expect(vi.mocked(matchApi)).toHaveBeenCalledWith(
        '/profile',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('Ownership'),
        }),
      ),
    );
  });

  it('uploading a résumé parses it, auto-saves, and shows it in the Resume tab', async () => {
    const user = userEvent.setup();
    const normalized = {
      fullName: 'Parsed Name', email: null, phone: null, location: null,
      summary: 'Parsed from résumé.',
      seniority: 'Staff',
      domains: ['ai'],
      experience: [{ title: 'Parsed Role', company: 'NewCo', dates: '2020–2024', highlights: ['Did things'] }],
      skills: { languages: ['Rust'], frameworks: [], infrastructure: [], databases: [], other: [] },
      education: [],
    };
    mockRoutes({
      'GET /profile': mockProfileResponse,
      'GET /profile/resume-file': NO_RESUME_FILE_ERROR,
      'POST /profile/normalize-file': normalized,
      'PUT /profile': { ...mockProfileResponse, structured: { ...mockProfileResponse.structured, ...normalized } },
    });

    renderWithRouter(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'About You' })).toBeInTheDocument());
    await gotoResumeTab(user);

    const file = new File(['resume bytes'], 'resume.pdf', { type: 'application/pdf' });
    const input = screen.getByTestId('resume-file-input') as HTMLInputElement;
    await userEvent.upload(input, file);

    await waitFor(() =>
      expect(vi.mocked(matchApi)).toHaveBeenCalledWith(
        '/profile/normalize-file',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
      ),
    );
    // Parsed contact info auto-saves — no review step.
    await waitFor(() =>
      expect(vi.mocked(matchApi)).toHaveBeenCalledWith(
        '/profile',
        expect.objectContaining({ method: 'PUT', body: expect.stringContaining('Parsed Name') }),
      ),
    );
    expect(await screen.findByText('Parsed Name')).toBeInTheDocument();
  });

  it('shows the stored résumé inline when one already exists', async () => {
    const user = userEvent.setup();
    mockRoutes({
      'GET /profile': mockProfileResponse,
      'GET /profile/resume-file': {
        fileName: 'resume.pdf', contentType: 'application/pdf',
        uploadedAt: '2026-05-01T00:00:00Z', textContent: null, pageCount: 1,
      },
    });

    renderWithRouter(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'About You' })).toBeInTheDocument());
    await gotoResumeTab(user);

    expect(await screen.findByRole('button', { name: /replace résumé/i })).toBeInTheDocument();
    expect(screen.queryByText('No résumé uploaded yet — use the button above.')).not.toBeInTheDocument();
    // A single-page PDF has nothing to page through — no pager shown.
    expect(screen.queryByText(/page 1 of/i)).not.toBeInTheDocument();
  });

  it('shows a custom pager for a multi-page PDF and steps through pages', async () => {
    const user = userEvent.setup();
    mockRoutes({
      'GET /profile': mockProfileResponse,
      'GET /profile/resume-file': {
        fileName: 'resume.pdf', contentType: 'application/pdf',
        uploadedAt: '2026-05-01T00:00:00Z', textContent: null, pageCount: 2,
      },
    });

    renderWithRouter(<SettingsPage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'About You' })).toBeInTheDocument());
    await gotoResumeTab(user);

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  it('shows error state when the initial profile load fails', async () => {
    mockRoutes({
      'GET /profile': new Error('Network error'),
      'GET /profile/resume-file': NO_RESUME_FILE_ERROR,
    });

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
