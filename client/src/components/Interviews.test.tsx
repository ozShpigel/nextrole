import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { api } from '../lib/api';
import { InterviewModal } from './Interviews';
import type { Interview } from '../lib/types';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

const baseInterview: Interview = {
  id: 'int-1',
  applicationId: 'app-1',
  type: 'Phone',
  scheduledAt: new Date('2026-01-15T10:00:00Z').toISOString(),
  completed: false,
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InterviewModal — completed-flip retro trigger', () => {
  it('saves immediately, without a retro modal, when Completed is not flipped', async () => {
    vi.mocked(api).mockResolvedValue({ ...baseInterview });
    const onSaved = vi.fn();
    renderWithRouter(<InterviewModal appId="app-1" interview={baseInterview} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('How did it go?')).not.toBeInTheDocument();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('opens the retro modal instead of saving when Completed flips false→true, and Save merges retro fields into one PUT', async () => {
    vi.mocked(api).mockResolvedValue({ ...baseInterview, completed: true });
    const onSaved = vi.fn();
    renderWithRouter(<InterviewModal appId="app-1" interview={baseInterview} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /completed/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('How did it go?')).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '4' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save retro' }));

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const [path, options] = vi.mocked(api).mock.calls[0];
    expect(path).toBe('/interviews/int-1');
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.completed).toBe(true);
    expect(body.retroRating).toBe(4);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('Skip on the retro modal still persists the completed flip, without retro fields', async () => {
    vi.mocked(api).mockResolvedValue({ ...baseInterview, completed: true });
    const onSaved = vi.fn();
    renderWithRouter(<InterviewModal appId="app-1" interview={baseInterview} onClose={vi.fn()} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /completed/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }));

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const [, options] = vi.mocked(api).mock.calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.completed).toBe(true);
    expect(body.retroRating).toBeUndefined();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
