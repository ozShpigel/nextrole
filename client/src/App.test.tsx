import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, matchApi } from './lib/api';
import App from './App';

vi.mock('./lib/api', async () => {
  const actual = await vi.importActual<typeof import('./lib/api')>('./lib/api');
  return { ...actual, api: vi.fn(), matchApi: vi.fn() };
});

function renderAppAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<App />}>
            <Route path="/" element={<div>Landing content</div>} />
            <Route path="/search" element={<div>Search content</div>} />
            <Route path="/settings" element={<div>Settings content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// GET /api/match/profile ALWAYS returns a `content` string, and for a visitor
// who has uploaded nothing that string is the rendered wrapper of an empty
// profile — not "". Modelling it as "" is what let the old content-based
// onboarding check pass its tests while treating every visitor as a returning
// one in production. `structured` is what actually says whether anyone is
// there, which is the same field the server's own scan tests.
const EMPTY_PROFILE_CONTENT = `<professional_profile>

</professional_profile>`;

function mockBackend({ resumeFile, hasProfile, signIn = { signedIn: false, email: null, available: true } }: {
  resumeFile: boolean;
  hasProfile: boolean;
  signIn?: { signedIn: boolean; email: string | null; available: boolean };
}) {
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({});
    if (path === '/auth/me') return Promise.resolve(signIn);
    if (path === '/auth/signout') return Promise.resolve(null);
    return Promise.reject(new Error(`unexpected api path: ${path}`));
  });
  vi.mocked(matchApi).mockImplementation((path: string) => {
    if (path === '/profile') {
      return Promise.resolve(
        hasProfile
          ? {
              content: '<professional_profile>Senior engineer…</professional_profile>',
              structured: { experience: [{ title: 'Senior Engineer' }], skills: [] },
            }
          : { content: EMPTY_PROFILE_CONTENT, structured: { experience: [], skills: [] } },
      );
    }
    if (path === '/profile/resume-file') {
      return resumeFile
        ? Promise.resolve({ fileName: 'resume.pdf', contentType: 'application/pdf', uploadedAt: '2026-01-01', textContent: null })
        : Promise.reject(Object.assign(new Error('Not Found'), { status: 404 }));
    }
    return Promise.reject(new Error(`unexpected matchApi path: ${path}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('App onboarding gate', () => {
  it('redirects to the landing page when there is no profile content and no résumé', async () => {
    mockBackend({ resumeFile: false, hasProfile: false });
    renderAppAt('/search');

    expect(await screen.findByText('Landing content')).toBeInTheDocument();
    expect(screen.queryByText('Search content')).not.toBeInTheDocument();
  });

  it('renders the requested page once a résumé is on file, even with empty profile content', async () => {
    mockBackend({ resumeFile: true, hasProfile: false });
    renderAppAt('/search');

    expect(await screen.findByText('Search content')).toBeInTheDocument();
  });

  it('renders the requested page once the profile has real content, even with no résumé', async () => {
    mockBackend({ resumeFile: false, hasProfile: true });
    renderAppAt('/search');

    expect(await screen.findByText('Search content')).toBeInTheDocument();
  });

  it('never redirects away from the landing page itself', async () => {
    mockBackend({ resumeFile: false, hasProfile: false });
    renderAppAt('/');

    expect(await screen.findByText('Landing content')).toBeInTheDocument();
  });

  it('never redirects away from Settings, so onboarding can actually be completed', async () => {
    mockBackend({ resumeFile: false, hasProfile: false });
    renderAppAt('/settings');

    await waitFor(() => expect(matchApi).toHaveBeenCalled());
    expect(screen.getByText('Settings content')).toBeInTheDocument();
  });

  it('fails open on a query error instead of redirecting a real user home', async () => {
    vi.mocked(api).mockResolvedValue({});
    vi.mocked(matchApi).mockRejectedValue(new Error('502 Bad Gateway'));
    renderAppAt('/search');

    expect(await screen.findByText('Search content')).toBeInTheDocument();
  });
});

// Sign-in is offered in the nav, never required: the uid cookie is still the
// only identity and uploading a CV is the whole onboarding. The link exists so
// a visitor whose cookie is gone (cleared, or a different device) has a way
// back to their account at all.
describe('App nav sign-in', () => {
  it('offers Google sign-in to a visitor with no profile', async () => {
    mockBackend({ resumeFile: false, hasProfile: false });
    renderAppAt('/');
    const link = await screen.findByRole('link', { name: /sign in with google/i });
    expect(link).toHaveAttribute('href', '/api/auth/google/start');
  });

  // Already onboarded but anonymous: still offered. Signing in links THIS
  // account to Google (GoogleSignInResolver), and is the only way back to it
  // once the cookie is gone.
  it('offers Google sign-in to an onboarded visitor who is not signed in', async () => {
    mockBackend({ resumeFile: true, hasProfile: true });
    renderAppAt('/search');
    const link = await screen.findByRole('link', { name: /sign in with google/i });
    expect(link).toHaveAttribute('href', '/api/auth/google/start');
  });

  it('shows who is signed in, and signs out', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    mockBackend({ resumeFile: true, hasProfile: true, signIn: { signedIn: true, email: 'ada@example.com', available: true } });
    renderAppAt('/search');

    const chip = await screen.findByRole('button', { name: 'Account: ada@example.com' });
    expect(chip).toHaveTextContent('A');
    expect(screen.queryByRole('link', { name: /sign in with google/i })).not.toBeInTheDocument();

    await userEvent.click(chip);
    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(vi.mocked(api)).toHaveBeenCalledWith('/auth/signout', { method: 'POST' });
    vi.unstubAllGlobals();
  });

  // Fixed-mode (private) instances take identity from configuration and issue
  // no cookie, so there is nothing for a sign-in to change. The client cannot
  // tell that from the URL — the server says so via /auth/me.
  it('hides Google sign-in when the instance cannot do sign-in', async () => {
    mockBackend({ resumeFile: false, hasProfile: false, signIn: { signedIn: false, email: null, available: false } });
    renderAppAt('/');
    await screen.findByText('Landing content');
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/auth/me'));
    expect(screen.queryByRole('link', { name: /sign in with google/i })).not.toBeInTheDocument();
  });
});
