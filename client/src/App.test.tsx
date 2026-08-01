import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, matchApi } from './lib/api';
import App from './App';

vi.mock('./lib/api', () => ({ api: vi.fn(), matchApi: vi.fn() }));

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

function mockBackend({ resumeFile, profileContent }: { resumeFile: boolean; profileContent: string }) {
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/config') return Promise.resolve({ demoMode: false });
    return Promise.reject(new Error(`unexpected api path: ${path}`));
  });
  vi.mocked(matchApi).mockImplementation((path: string) => {
    if (path === '/profile') return Promise.resolve({ content: profileContent });
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
    mockBackend({ resumeFile: false, profileContent: '' });
    renderAppAt('/search');

    expect(await screen.findByText('Landing content')).toBeInTheDocument();
    expect(screen.queryByText('Search content')).not.toBeInTheDocument();
  });

  it('renders the requested page once a résumé is on file, even with empty profile content', async () => {
    mockBackend({ resumeFile: true, profileContent: '' });
    renderAppAt('/search');

    expect(await screen.findByText('Search content')).toBeInTheDocument();
  });

  it('renders the requested page once profile content exists, even with no résumé', async () => {
    mockBackend({ resumeFile: false, profileContent: 'Senior engineer with 8 years experience...' });
    renderAppAt('/search');

    expect(await screen.findByText('Search content')).toBeInTheDocument();
  });

  it('never redirects away from the landing page itself', async () => {
    mockBackend({ resumeFile: false, profileContent: '' });
    renderAppAt('/');

    expect(await screen.findByText('Landing content')).toBeInTheDocument();
  });

  it('never redirects away from Settings, so onboarding can actually be completed', async () => {
    mockBackend({ resumeFile: false, profileContent: '' });
    renderAppAt('/settings');

    await waitFor(() => expect(matchApi).toHaveBeenCalled());
    expect(screen.getByText('Settings content')).toBeInTheDocument();
  });

  it('fails open on a query error instead of redirecting a real user home', async () => {
    vi.mocked(api).mockResolvedValue({ demoMode: false });
    vi.mocked(matchApi).mockRejectedValue(new Error('502 Bad Gateway'));
    renderAppAt('/search');

    expect(await screen.findByText('Search content')).toBeInTheDocument();
  });
});
