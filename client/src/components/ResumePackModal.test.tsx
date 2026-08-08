import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import { api } from '../lib/api';
import { ResumePackModal } from './ResumePackModal';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, api: vi.fn() };
});

describe('ResumePackModal', () => {
  it('renders the persisted pack as a PDF preview and a download link', async () => {
    vi.mocked(api).mockResolvedValue({
      tailoredSummary: 'A grounded, tailored summary.',
      experience: [
        { title: 'Senior Engineer', company: 'Acme', dates: '2021–2024', highlights: ['Shipped the thing', 'Owned the pipeline'] },
      ],
      highlightedSkills: ['TypeScript', 'React'],
      generatedAt: '2026-01-15T00:00:00Z',
    });

    renderWithRouter(
      <ResumePackModal appId="app-1" jobTitle="Staff Engineer" company="Acme" open onClose={() => {}} />,
    );

    expect(await screen.findByText(/generated/i)).toBeInTheDocument();

    const embed = document.querySelector('embed[type="application/pdf"]');
    expect(embed).toBeInTheDocument();
    expect(embed).toHaveAttribute('src', expect.stringContaining('/applications/app-1/pack/pdf'));

    const downloadLink = screen.getByRole('link', { name: /download pdf/i });
    expect(downloadLink).toHaveAttribute('href', expect.stringContaining('/applications/app-1/pack/pdf'));
    expect(downloadLink).toHaveAttribute('download');
  });

  it('shows nothing to review while the pack is still loading', async () => {
    vi.mocked(api).mockReturnValue(new Promise(() => {}));

    renderWithRouter(
      <ResumePackModal appId="app-1" jobTitle="Staff Engineer" company="Acme" open onClose={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText(/loading/i)).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /download pdf/i })).not.toBeInTheDocument();
  });
});
