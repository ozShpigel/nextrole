import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { matchApi } from '../lib/api';
import InterviewPrepPage from './InterviewPrepPage';

vi.mock('../lib/api', () => ({
  matchApi: vi.fn(),
}));

const mockPrepResponse = {
  self_presentation_hr: 'HR presentation text.',
  self_presentation_technical: 'Technical presentation text.',
  presenting_work_project: 'Work project pitch.',
  presenting_personal_project: 'Personal project pitch.',
  qa_rubric: [
    { question: 'Where do you see yourself in 5 years?', answer: 'Growing.', categories: ['HR'], topic: '' },
    { question: 'Walk me through the Payoneer project', answer: 'It was a payments platform.', categories: ['Technical'], topic: 'Payoneer project' },
  ],
  self_presentation_hr_cues: [],
  self_presentation_technical_cues: [],
  updated_at: '2026-07-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InterviewPrepPage', () => {
  it('renders the three sections and the sticky section nav', async () => {
    vi.mocked(matchApi).mockResolvedValue(mockPrepResponse);

    renderWithRouter(<InterviewPrepPage />);

    await waitFor(() => {
      expect(screen.getByText('Project presentations')).toBeInTheDocument();
    });

    const nav = screen.getByRole('navigation', { name: /page sections/i });
    expect(within(nav).getByRole('button', { name: /self-presentation/i })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /question rubric/i })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /projects/i })).toBeInTheDocument();

    // Section anchors the nav scrolls to.
    expect(document.getElementById('prep-section-01')).toBeInTheDocument();
    expect(document.getElementById('prep-section-02')).toBeInTheDocument();
    expect(document.getElementById('prep-section-03')).toBeInTheDocument();

    // Rubric renders collapsed under its topic groups.
    expect(screen.getByText('Payoneer project')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.queryByText('It was a payments platform.')).not.toBeInTheDocument();
  });

  it('saves rubric edits with categories and topic in the PUT body', async () => {
    vi.mocked(matchApi).mockImplementation((_path: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        const body = JSON.parse(opts.body as string);
        return Promise.resolve({ ...mockPrepResponse, qa_rubric: body.qa_rubric }) as never;
      }
      return Promise.resolve(mockPrepResponse) as never;
    });

    renderWithRouter(<InterviewPrepPage />);
    await waitFor(() => expect(screen.getByText('Where do you see yourself in 5 years?')).toBeInTheDocument());

    // Save is hidden behind the dirty check until an edit lands.
    expect(screen.getByRole('button', { name: /save question rubric/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /where do you see yourself/i }));
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Answer' }), ' And mentoring.');

    const save = screen.getByRole('button', { name: /save question rubric/i });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => {
      expect(vi.mocked(matchApi)).toHaveBeenCalledWith(
        '/interview-prep',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
    const putCall = vi.mocked(matchApi).mock.calls.find(([, opts]) => (opts as RequestInit)?.method === 'PUT')!;
    const body = JSON.parse((putCall[1] as RequestInit).body as string);
    expect(body.qa_rubric).toEqual([
      expect.objectContaining({ answer: 'Growing. And mentoring.', categories: ['HR'], topic: '' }),
      expect.objectContaining({ question: 'Walk me through the Payoneer project', categories: ['Technical'], topic: 'Payoneer project' }),
    ]);

    expect(await screen.findByText('Question rubric saved successfully')).toBeInTheDocument();
  });

  it('shows error state when the load fails', async () => {
    vi.mocked(matchApi).mockRejectedValue(new Error('Network error'));

    renderWithRouter(<InterviewPrepPage />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load: network error/i)).toBeInTheDocument();
    });
  });
});
