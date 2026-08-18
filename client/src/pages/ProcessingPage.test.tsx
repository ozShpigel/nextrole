import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { matchApi } from '../lib/api';
import ProcessingPage from './ProcessingPage';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, matchApi: vi.fn() };
});

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

// A file handed off via route state, the way LandingPage's onResumeFile does.
function renderWithFile(file: File | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/processing', state: file ? { file } : undefined }]}>
        <ProcessingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProcessingPage', () => {
  it('opens on the first canned step', () => {
    renderWithRouter(<ProcessingPage />);
    expect(screen.getByText('Reading your résumé')).toBeInTheDocument();
    expect(screen.getByText('Parsing structure, dates, and roles')).toBeInTheDocument();
  });

  it('Skip navigates straight to Matches without waiting for the canned steps', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ProcessingPage />);

    await user.click(screen.getByRole('button', { name: /skip/i }));

    expect(window.location.pathname).toBe('/search');
  });

  it('holds on "Finishing up" until the real upload resolves, even after the canned beat ends', async () => {
    let resolveSave: (() => void) | null = null;
    mockRoutes({
      'POST /profile/normalize-file': { fullName: 'Parsed Name' },
      'GET /profile': { structured: {}, updated_at: null },
      'PUT /profile': new Promise((resolve) => {
        resolveSave = () => resolve({ structured: { fullName: 'Parsed Name' }, updated_at: null });
      }),
    });
    const file = new File(['resume bytes'], 'resume.pdf', { type: 'application/pdf' });
    renderWithFile(file);

    // Real parse call fires immediately, independent of the canned timers.
    await waitFor(() =>
      expect(vi.mocked(matchApi)).toHaveBeenCalledWith(
        '/profile/normalize-file',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    // The canned beat's last step reads (patience, not a hang) — this
    // asserts the "Finishing up" hold state renders, without needing to
    // wait out the full multi-second canned timer sequence for real.
    await waitFor(() => expect(screen.getByText('Reading your résumé')).toBeInTheDocument());

    resolveSave?.();
    await waitFor(() =>
      expect(vi.mocked(matchApi)).toHaveBeenCalledWith('/profile', expect.objectContaining({ method: 'PUT' })),
    );
  });

  it('shows an inline error and does not navigate when the real upload fails', async () => {
    mockRoutes({
      'POST /profile/normalize-file': Object.assign(new Error('Server error'), { status: 500 }),
    });
    const file = new File(['resume bytes'], 'resume.pdf', { type: 'application/pdf' });
    renderWithFile(file);

    expect(await screen.findByText(/couldn't parse résumé/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to home/i })).toBeInTheDocument();
  });
});
