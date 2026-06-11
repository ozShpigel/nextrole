import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import { matchApi } from '../lib/api';
import SettingsPage from './SettingsPage';

vi.mock('../lib/api', () => ({
  matchApi: vi.fn(),
}));

const mockProfileResponse = {
  content: 'test profile content',
  analyst_prompt: 'test analyst prompt',
  analyst_prompt_is_override: false,
  evaluator_prompt: 'test evaluator prompt with {{USER_PROFILE}} and {{PARSED_JOB}}',
  evaluator_prompt_is_override: false,
  updated_at: '2026-05-01T00:00:00Z',
  scoring_config: {
    analyst: { model: 'claude-sonnet-4-6', temperature: 0.3, max_tokens: 4096, thinking_enabled: true, thinking_budget: 2048 },
    evaluator: { model: 'claude-sonnet-4-6', temperature: 0.3, max_tokens: 4096, thinking_enabled: true, thinking_budget: 2048 },
    min_score_to_save: 70,
  },
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

    expect(screen.getByText('Analyst Prompt')).toBeInTheDocument();
    expect(screen.getByText('Evaluator Prompt')).toBeInTheDocument();
    expect(screen.getByText('Analysis Config')).toBeInTheDocument();
    expect(screen.getByText('Scoring Structure')).toBeInTheDocument();

    expect(screen.queryByRole('status', { name: /loading settings/i })).not.toBeInTheDocument();
  });

  it('shows error state when API fails', async () => {
    vi.mocked(matchApi).mockRejectedValueOnce(new Error('Network error'));

    renderWithRouter(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });
});
