import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { api } from '../lib/api';
import MessagesPage from './MessagesPage';
import type { MessageItem } from '../lib/types';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

const matched: MessageItem = {
  id: 'msg-1',
  applicationId: 'app-1',
  company: 'Acme Corp',
  jobTitle: 'Backend Engineer',
  subject: 'Your interview is confirmed',
  from: 'hr@acme.example',
  updateType: 'InterviewScheduled',
  snippet: 'We would like to schedule a technical interview.',
  receivedAt: '2026-01-15T10:00:00Z',
  isRead: false,
};

const unmatched: MessageItem = {
  id: 'msg-2',
  applicationId: null,
  company: 'Globex',
  jobTitle: null,
  subject: 'Thanks for applying',
  from: 'noreply@globex.example',
  updateType: 'ApplicationReceived',
  snippet: 'We received your application.',
  receivedAt: '2026-01-10T08:00:00Z',
  isRead: false,
};

function mockMessages(messages: MessageItem[] | Error) {
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/messages') return messages instanceof Error ? Promise.reject(messages) : Promise.resolve(messages);
    if (path.endsWith('/read')) return Promise.resolve(undefined);
    return Promise.reject(new Error(`unexpected path in test: ${path}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessagesPage', () => {
  it('auto-selects the first message and shows its company, subject, snippet, and update-type badge in the detail pane', async () => {
    mockMessages([matched]);
    renderWithRouter(<MessagesPage />);

    // Company appears in both the list row and the detail pane — assert both render.
    await waitFor(() => expect(screen.getAllByText(/Acme Corp/).length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('Your interview is confirmed')).toBeInTheDocument();
    expect(screen.getByText(/We would like to schedule a technical interview/)).toBeInTheDocument();
    expect(screen.getByText('Interview scheduled')).toBeInTheDocument();
  });

  it('flags an unmatched message as not tracked in its list row', async () => {
    mockMessages([unmatched]);
    renderWithRouter(<MessagesPage />);

    await waitFor(() => expect(screen.getByText('Not tracked')).toBeInTheDocument());
  });

  it('does not show a "not tracked" badge for a matched message', async () => {
    mockMessages([matched]);
    renderWithRouter(<MessagesPage />);

    await waitFor(() => expect(screen.getAllByText(/Acme Corp/).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText('Not tracked')).not.toBeInTheDocument();
  });

  it('selects a different message on click and updates the detail pane', async () => {
    const user = userEvent.setup();
    mockMessages([matched, unmatched]);
    renderWithRouter(<MessagesPage />);

    await waitFor(() => expect(screen.getAllByText(/Acme Corp/).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText('Thanks for applying')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Globex/ }));

    expect(await screen.findByText('Thanks for applying')).toBeInTheDocument();
  });

  it('filters the message list by company/role search', async () => {
    const user = userEvent.setup();
    mockMessages([matched, unmatched]);
    renderWithRouter(<MessagesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Globex/ })).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search company or role'), 'acme');

    expect(screen.getByRole('button', { name: /Acme Corp/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Globex/ })).not.toBeInTheDocument();
  });

  it('shows an unread-count badge and marks the auto-selected message read', async () => {
    mockMessages([matched, unmatched]);
    renderWithRouter(<MessagesPage />);

    expect(await screen.findByText('2 unread')).toBeInTheDocument();
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/messages/${matched.id}/read`, { method: 'PATCH' }));
  });

  it('shows a plain message count once nothing is unread', async () => {
    mockMessages([{ ...matched, isRead: true }, { ...unmatched, isRead: true }]);
    renderWithRouter(<MessagesPage />);

    expect(await screen.findByText('2 messages')).toBeInTheDocument();
    expect(screen.queryByText(/unread/)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no messages yet', async () => {
    mockMessages([]);
    renderWithRouter(<MessagesPage />);

    expect(await screen.findByText(/No messages yet/)).toBeInTheDocument();
  });

  it('shows an error message when the load fails', async () => {
    mockMessages(new Error('Network error'));
    renderWithRouter(<MessagesPage />);

    expect(await screen.findByText(/Couldn't load messages: Network error/)).toBeInTheDocument();
  });
});
