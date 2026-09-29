import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { api } from '../lib/api';
import { FeatureRoute, LockedButton } from './ComingSoon';

vi.mock('../lib/api', () => ({ api: vi.fn(), matchApi: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('LockedButton', () => {
  it('stays focusable and clickable, and explains itself in a dialog', async () => {
    renderWithRouter(<LockedButton feature="AutoApply" className="">One-click apply</LockedButton>);

    const button = screen.getByRole('button', { name: /one-click apply/i });
    // aria-disabled, not disabled: a disabled button can be neither reached
    // nor clicked, so it could never say why it is locked.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent(/coming soon/i);

    await userEvent.click(button);
    expect(await screen.findByRole('dialog')).toHaveTextContent(/one-click apply is coming soon/i);
  });
});

describe('FeatureRoute', () => {
  const page = (
    <FeatureRoute feature="PracticeInterview" backTo="/interview-prep" backLabel="Back to Interview Prep">
      <p>the practice page</p>
    </FeatureRoute>
  );

  it('shows the page to a visitor who may use the feature', async () => {
    vi.mocked(api).mockResolvedValue({ PracticeInterview: true });
    renderWithRouter(page);
    expect(await screen.findByText('the practice page')).toBeInTheDocument();
  });

  it('locks the page itself for one who may not, so a typed-in URL is locked too', async () => {
    vi.mocked(api).mockResolvedValue({ PracticeInterview: false });
    renderWithRouter(page);
    expect(await screen.findByText(/practice interview is coming soon/i)).toBeInTheDocument();
    expect(screen.queryByText('the practice page')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to interview prep/i })).toHaveAttribute('href', '/interview-prep');
  });

  it('treats a failed feature request as locked', async () => {
    vi.mocked(api).mockRejectedValue(new Error('HTTP 500'));
    renderWithRouter(page);
    expect(await screen.findByText(/practice interview is coming soon/i)).toBeInTheDocument();
  });

  it('renders nothing while the answer loads, rather than flash the locked state', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(api).mockReturnValue(new Promise((r) => { resolve = r; }));
    renderWithRouter(page);

    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
    expect(screen.queryByText('the practice page')).not.toBeInTheDocument();

    resolve({ PracticeInterview: true });
    await waitFor(() => expect(screen.getByText('the practice page')).toBeInTheDocument());
  });
});
