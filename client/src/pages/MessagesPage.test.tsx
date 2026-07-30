import { screen, waitFor } from '@testing-library/react';
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
};

function mockMessages(messages: MessageItem[] | Error) {
  vi.mocked(api).mockImplementation((path: string) => {
    if (path === '/messages') return messages instanceof Error ? Promise.reject(messages) : Promise.resolve(messages);
    return Promise.reject(new Error(`unexpected path in test: ${path}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessagesPage', () => {
  it('renders each message with company, subject, snippet, and update-type badge', async () => {
    mockMessages([matched]);
    renderWithRouter(<MessagesPage />);

    await waitFor(() => expect(screen.getByText(/Acme Corp/)).toBeInTheDocument());
    expect(screen.getByText('Your interview is confirmed')).toBeInTheDocument();
    expect(screen.getByText(/We would like to schedule a technical interview/)).toBeInTheDocument();
    expect(screen.getByText('Interview scheduled')).toBeInTheDocument();
  });

  it('links a matched message to its application', async () => {
    mockMessages([matched]);
    renderWithRouter(<MessagesPage />);

    const link = await screen.findByRole('link', { name: /Acme Corp/ });
    expect(link).toHaveAttribute('href', '/tracker/app-1');
  });

  it('flags an unmatched message and renders it without a link', async () => {
    mockMessages([unmatched]);
    renderWithRouter(<MessagesPage />);

    await waitFor(() => expect(screen.getByText(/Globex/)).toBeInTheDocument());
    expect(screen.getByText(/not matched to a tracked application/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Globex/ })).not.toBeInTheDocument();
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
