import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { discoveryApi, matchApi } from '../lib/api';
import ProcessingPage from './ProcessingPage';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, matchApi: vi.fn(), discoveryApi: vi.fn() };
});

// The third milestone polls this until the scan it started has written
// something. `total: 0` keeps the page waiting, which is what most of these
// tests want to observe.
function mockMatchCount(total: number) {
  vi.mocked(discoveryApi).mockResolvedValue({ jobs: [], total });
}

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
//
// Under StrictMode on purpose: the upload effect runs once per file behind a
// ref, and pairing that ref with a `cancelled` cleanup flag once cancelled the
// only invocation allowed to run — the parse completed and the profile was
// never saved. Without the double-invoke here, the suite cannot see it.
function renderWithFile(file: File | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[{ pathname: '/processing', state: file ? { file } : undefined }]}>
          <ProcessingPage />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMatchCount(0);
});

describe('ProcessingPage', () => {
  it('opens on the first canned step', () => {
    renderWithRouter(<ProcessingPage />);
    expect(screen.getByText('Reading your résumé')).toBeInTheDocument();
    expect(screen.getByText('Parsing structure, dates, and roles')).toBeInTheDocument();
  });

  // A first upload has nowhere useful to skip TO: Matches is empty until the
  // scan this page started lands, so the escape hatch would drop a new visitor
  // on a blank screen and read as the product being broken.
  it('offers no Skip on a first upload', async () => {
    mockRoutes({
      'GET /profile': { content: '', structured: {} },
      'GET /profile/resume-file': Object.assign(new Error('not found'), { status: 404 }),
    });
    renderWithRouter(<ProcessingPage />);
    await waitFor(() => expect(vi.mocked(matchApi)).toHaveBeenCalledWith('/profile'));
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('offers Skip to someone who already has matches', async () => {
    mockRoutes({
      'GET /profile': { content: '<professional_profile>…', structured: {} },
      'GET /profile/resume-file': { fileName: 'cv.pdf' },
    });
    renderWithRouter(<ProcessingPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /skip/i }));
    expect(window.location.pathname).toBe('/search');
  });

  // The rule this page exists to keep: the end state is caused by the work
  // ending, never by a timer. The animation used to run on canned step
  // durations totalling 4.6s while a parse takes 10-20s, so the circles
  // finished merging and then sat idle — a completed animation with nothing
  // happening, which reads as stuck.
  //
  // data-merged is the number of circles that have come together, and it is
  // set from resolved milestones only, so asserting on it tests the rule
  // rather than whichever label is on screen.
  it('merges one circle per resolved milestone, and not before', async () => {
    let resolveParse: ((v: unknown) => void) | null = null;
    let resolveSave: ((v: unknown) => void) | null = null;
    mockRoutes({
      'POST /profile/normalize-file': new Promise((r) => { resolveParse = r; }),
      'GET /profile': { structured: {}, updated_at: null },
      'PUT /profile': new Promise((r) => { resolveSave = r; }),
    });
    renderWithFile(new File(['resume bytes'], 'resume.pdf', { type: 'application/pdf' }));

    // Parsing: nothing has resolved, so nothing has merged.
    await waitFor(() =>
      expect(vi.mocked(matchApi)).toHaveBeenCalledWith(
        '/profile/normalize-file',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(screen.getByTestId('venn')).toHaveAttribute('data-merged', '0');

    resolveParse?.({ fullName: 'Parsed Name' });
    // Parsed, but the save is still pending: one circle in.
    await waitFor(() => expect(screen.getByTestId('venn')).toHaveAttribute('data-merged', '1'));

    resolveSave?.({ structured: { fullName: 'Parsed Name' }, updated_at: null });
    // Saved. The third circle waits on the scan, which has scored nothing yet.
    await waitFor(() => expect(screen.getByTestId('venn')).toHaveAttribute('data-merged', '2'));
    expect(screen.queryByText("You're all set")).not.toBeInTheDocument();

    // The scan produces its first results.
    mockMatchCount(25);
    await waitFor(() => expect(screen.getByTestId('venn')).toHaveAttribute('data-merged', '3'), { timeout: 8000 });
    // Past findByText's 1s default on purpose: MIN_DISPLAY_MS holds the end
    // state back so a fast response cannot flash in and out.
    expect(await screen.findByText("You're all set", {}, { timeout: 3000 })).toBeInTheDocument();
  }, 20000);

  it('cannot reach the end state on elapsed time alone', async () => {
    // The regression itself. Real time, deliberately longer than both the old
    // 4.6s canned sequence and the 1.1s minimum display, with the save left
    // pending throughout.
    mockRoutes({
      'POST /profile/normalize-file': { fullName: 'Parsed Name' },
      'GET /profile': { structured: {}, updated_at: null },
      'PUT /profile': { structured: { fullName: 'Parsed Name' }, updated_at: null },
      'POST /pool-scan': new Promise(() => {}), // scan never returns
    });
    mockMatchCount(0); // and never scores anything
    renderWithFile(new File(['resume bytes'], 'resume.pdf', { type: 'application/pdf' }));

    await waitFor(() => expect(screen.getByTestId('venn')).toHaveAttribute('data-merged', '2'));
    await new Promise((r) => setTimeout(r, 5200));

    expect(screen.getByTestId('venn')).toHaveAttribute('data-merged', '2');
    expect(screen.queryByText("You're all set")).not.toBeInTheDocument();
    // Still on a waiting label rather than the payoff.
    expect(screen.getByText('Finding your matches')).toBeInTheDocument();
  }, 12000);

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
