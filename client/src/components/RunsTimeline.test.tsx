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
    expect(screen.getByText('No collection runs yet')).toBeInTheDocument();
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
    { status: 'embedding', label: 'Embedding' },
    { status: 'pending', label: 'Pending' },
  ])('$status run shows abort button', ({ status }) => {
    renderWithRouter(
      <RunsTimeline runs={[makeRun({ status, completed_at: null })]} onAbort={noop} />,
    );
    expect(screen.getByRole('button', { name: 'Abort collection run' })).toBeInTheDocument();
  });

  it('completed run does not show abort button', () => {
    renderWithRouter(
      <RunsTimeline runs={[makeRun({ status: 'completed' })]} onAbort={noop} />,
    );
    expect(screen.queryByRole('button', { name: 'Abort collection run' })).not.toBeInTheDocument();
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

  it('run card shows a start time, with the date carried by the day header', () => {
    renderWithRouter(
      <RunsTimeline
        runs={[makeRun({ started_at: new Date('2026-05-01T14:30:00Z').toISOString() })]}
        onAbort={noop}
      />,
    );
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText('1 May 2026')).toBeInTheDocument();
  });
});

describe('RunsTimeline - Throttle visibility', () => {
  it('warns when searches failed or came back empty', () => {
    renderWithRouter(
      <RunsTimeline
        runs={[makeRun({ searches_total: 12, searches_failed: 5, searches_empty: 2 })]}
        onAbort={noop}
      />,
    );
    expect(screen.getByText(/7 of 12 board queries returned nothing — possibly rate-limited/)).toBeInTheDocument();
  });

  it('shows no warning on a healthy run', () => {
    renderWithRouter(
      <RunsTimeline
        runs={[makeRun({ searches_total: 12, searches_failed: 0, searches_empty: 3 })]}
        onAbort={noop}
      />,
    );
    expect(screen.queryByText(/rate-limited/)).not.toBeInTheDocument();
  });

  it('warns when every search came back empty even without failures', () => {
    renderWithRouter(
      <RunsTimeline
        runs={[makeRun({ searches_total: 6, searches_failed: 0, searches_empty: 6 })]}
        onAbort={noop}
      />,
    );
    expect(screen.getByText(/6 of 6 board queries returned nothing/)).toBeInTheDocument();
  });
});

describe('RunsTimeline - Day grouping', () => {
  const daysAgo = (n: number, hour = 9) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  it('groups runs under Today / Yesterday headers', () => {
    renderWithRouter(
      <RunsTimeline
        runs={[
          makeRun({ criteria_name: 'Run A', started_at: daysAgo(0) }),
          makeRun({ criteria_name: 'Run B', started_at: daysAgo(1) }),
        ]}
        onAbort={noop}
      />,
    );
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('folds day groups beyond the newest two into a collapsed Earlier details', () => {
    renderWithRouter(
      <RunsTimeline
        runs={[
          makeRun({ criteria_name: 'Run A', started_at: daysAgo(0) }),
          makeRun({ criteria_name: 'Run B', started_at: daysAgo(1) }),
          makeRun({ criteria_name: 'Run C', started_at: daysAgo(3) }),
          makeRun({ criteria_name: 'Run D', started_at: daysAgo(4) }),
        ]}
        onAbort={noop}
      />,
    );
    const summary = screen.getByText('Earlier');
    expect(summary).toBeInTheDocument();
    expect(screen.getByText('· 2 runs')).toBeInTheDocument();
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    // Old runs live inside the collapsed group, not the visible list.
    expect(details).toContainElement(screen.getByText('Run C'));
    expect(details).toContainElement(screen.getByText('Run D'));
    expect(details).not.toContainElement(screen.getByText('Run A'));
  });
});
