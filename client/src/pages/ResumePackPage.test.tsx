import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import { api } from '../lib/api';
import ResumePackPage from './ResumePackPage';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: vi.fn() };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'app-1' }) };
});

function mockRoutes(routes: Record<string, unknown>) {
  vi.mocked(api).mockImplementation((path: string, options?: { method?: string }) => {
    const key = `${options?.method ?? 'GET'} ${path}`;
    if (key in routes) {
      const value = routes[key];
      if (value instanceof Error) return Promise.reject(value);
      return Promise.resolve(value);
    }
    return Promise.reject(new Error(`Unmocked api() call: ${key}`));
  });
}

const mockApplication = {
  application: {
    id: 'app-1', jobTitle: 'Staff Engineer', company: 'Acme', jobUrl: 'https://example.com/jobs/1',
  },
};

describe('ResumePackPage', () => {
  it('renders the persisted pack as a PDF preview with a download link', async () => {
    mockRoutes({
      'GET /applications/app-1': mockApplication,
      'GET /applications/app-1/pack': {
        tailoredSummary: 'A grounded, tailored summary.',
        experience: [
          { title: 'Senior Engineer', company: 'Acme', dates: '2021–2024', highlights: ['Shipped the thing'] },
        ],
        highlightedSkills: [{ category: 'Languages', items: ['TypeScript', 'React'] }],
        generatedAt: '2026-01-15T00:00:00Z',
      },
    });

    renderWithRouter(<ResumePackPage />);

    expect(await screen.findByText(/generated/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /staff engineer.*acme/i })).toBeInTheDocument();

    const embed = document.querySelector('embed[type="application/pdf"]');
    expect(embed).toBeInTheDocument();
    expect(embed).toHaveAttribute('src', expect.stringContaining('/applications/app-1/pack/pdf'));

    const downloadLink = screen.getByRole('link', { name: /download pdf/i });
    expect(downloadLink).toHaveAttribute('href', expect.stringContaining('/applications/app-1/pack/pdf'));
    expect(downloadLink).toHaveAttribute('download');

    const viewJobLink = screen.getByRole('link', { name: /view job/i });
    expect(viewJobLink).toHaveAttribute('href', 'https://example.com/jobs/1');
    expect(viewJobLink).toHaveAttribute('target', '_blank');
  });

  it('hides the View Job link when the application has no job URL', async () => {
    mockRoutes({
      'GET /applications/app-1': { application: { ...mockApplication.application, jobUrl: null } },
      'GET /applications/app-1/pack': {
        tailoredSummary: 'A grounded, tailored summary.', experience: [], highlightedSkills: [],
        generatedAt: '2026-01-15T00:00:00Z',
      },
    });

    renderWithRouter(<ResumePackPage />);

    expect(await screen.findByText(/generated/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view job/i })).not.toBeInTheDocument();
  });

  it('offers to generate a pack when none exists yet', async () => {
    mockRoutes({
      'GET /applications/app-1': mockApplication,
      'GET /applications/app-1/pack': Object.assign(new Error('Not Found'), { status: 404 }),
    });

    renderWithRouter(<ResumePackPage />);

    await waitFor(() =>
      expect(screen.getByText(/no résumé pack generated yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /generate pack/i })).toBeInTheDocument();
    expect(document.querySelector('embed[type="application/pdf"]')).not.toBeInTheDocument();
  });

  it('shows a loading state while the pack is loading', async () => {
    mockRoutes({
      'GET /applications/app-1': mockApplication,
    });
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === '/applications/app-1') return Promise.resolve(mockApplication);
      return new Promise(() => {});
    });

    renderWithRouter(<ResumePackPage />);

    await waitFor(() => expect(screen.getByText(/loading/i)).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /download pdf/i })).not.toBeInTheDocument();
  });
});
