import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import { RunsTimeline } from './RunsTimeline';

const noop = () => {};

function makeRun(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    criteria_name: 'Test Run',
    status: 'completed' as const,
    jobs_scraped: 10,
    jobs_scored: 8,
    jobs_saved: 3,
    jobs_skipped_duplicate: 2,
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('RunsTimeline - Empty State', () => {
  it('shows empty message when no runs exist', () => {
    renderWithRouter(<RunsTimeline runs={[]} onAbort={noop} />);
    expect(screen.getByText('No searches yet')).toBeInTheDocument();
    expect(screen.getByText('Run your first criteria to start collecting jobs.')).toBeInTheDocument();
  });
});

describe('RunsTimeline - Run Cards', () => {
  it('shows completed run with status and stats', () => {
    renderWithRouter(
      <RunsTimeline
        runs={[makeRun({
          criteria_name: 'Backend Search',
          jobs_scraped: 12,
          jobs_scored: 10,
          jobs_saved: 4,
          jobs_skipped_duplicate: 2,
        })]}
        onAbort={noop}
      />,
    );
    expect(screen.getByText('Backend Search')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('scraped')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('scored')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('saved')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('duplicates')).toBeInTheDocument();
  });

  it('shows failed run status', () => {
    renderWithRouter(
      <RunsTimeline runs={[makeRun({ criteria_name: 'Failed Search', status: 'failed' })]} onAbort={noop} />,
    );
    expect(screen.getByText('Failed Search')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it.each([
    { status: 'scraping', label: 'Scraping' },
    { status: 'scoring', label: 'Scoring' },
    { status: 'pending', label: 'Pending' },
  ])('$status run shows abort button', ({ status }) => {
    renderWithRouter(
      <RunsTimeline runs={[makeRun({ status, completed_at: null })]} onAbort={noop} />,
    );
    expect(screen.getByRole('button', { name: 'Abort search' })).toBeInTheDocument();
  });

  it('completed run does not show abort button', () => {
    renderWithRouter(
      <RunsTimeline runs={[makeRun({ status: 'completed' })]} onAbort={noop} />,
    );
    expect(screen.queryByRole('button', { name: 'Abort search' })).not.toBeInTheDocument();
  });

  it('multiple runs appear in timeline', () => {
    renderWithRouter(
      <RunsTimeline
        runs={[
          makeRun({ criteria_name: 'Older Run' }),
          makeRun({ criteria_name: 'Newer Run' }),
        ]}
        onAbort={noop}
      />,
    );
    expect(screen.getByText('Older Run')).toBeInTheDocument();
    expect(screen.getByText('Newer Run')).toBeInTheDocument();
  });

  it('run card shows timestamp', () => {
    renderWithRouter(
      <RunsTimeline
        runs={[makeRun({ started_at: new Date('2026-05-01T14:30:00Z').toISOString() })]}
        onAbort={noop}
      />,
    );
    expect(screen.getByText(/\d{1,2}\/\d{1,2}\/\d{4}/)).toBeInTheDocument();
  });
});
