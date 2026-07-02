import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { discoveryApi } from '../lib/api';
import RunDetail from './RunDetailPage';

vi.mock('../lib/api', () => ({
  discoveryApi: vi.fn(),
  matchApi: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ runId: 'run-1' }) };
});

const mockRun = {
  id: 'run-1',
  criteria_name: 'React Developer Search',
  status: 'completed',
  jobs_scraped: 25,
  jobs_scored: 20,
  jobs_saved: 5,
  jobs_skipped_duplicate: 3,
};

function makeJob(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    title: 'Backend Engineer',
    company: 'TestCorp',
    location: 'Tel Aviv',
    description: 'A '.repeat(30) + 'long job description for testing purposes.',
    score: 75,
    verdict: 'YES',
    match_analysis: null,
    company_news: null,
    glassdoor_data: null,
    job_url: 'https://example.com/job/1',
    saved_to_tracker: false,
    dismissed: false,
    is_duplicate: false,
    evaluator_snapshot_input: null,
    evaluator_snapshot_output: null,
    analyst_snapshot_input: null,
    analyst_snapshot_output: null,
    ...overrides,
  };
}

function renderWithJobs(jobs: ReturnType<typeof makeJob>[], runOverrides = {}) {
  vi.mocked(discoveryApi)
    .mockResolvedValueOnce({ ...mockRun, ...runOverrides })
    .mockResolvedValueOnce(jobs);
  return renderWithRouter(<RunDetail />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RunDetailPage', () => {
  it('shows loading skeleton while fetching data', () => {
    vi.mocked(discoveryApi).mockReturnValue(new Promise(() => {}));
    renderWithRouter(<RunDetail />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading run details')).toBeInTheDocument();
  });

  it('renders run details and jobs after successful load', async () => {
    renderWithJobs([
      makeJob({ id: 'j1', title: 'Frontend Engineer', company: 'TechCo', location: 'Remote', score: 92, verdict: 'STRONG_YES' }),
      makeJob({ id: 'j2', title: 'Full Stack Developer', company: 'StartupInc', score: 65, verdict: 'MAYBE' }),
    ]);

    await waitFor(() => {
      expect(screen.getByText('React Developer Search')).toBeInTheDocument();
    });

    expect(screen.getByText('Scraped: 25')).toBeInTheDocument();
    expect(screen.getByText('Scored: 20')).toBeInTheDocument();
    expect(screen.getByText('Saved: 5')).toBeInTheDocument();
    expect(screen.getByText('Duplicates: 3')).toBeInTheDocument();
    expect(screen.getByText('Frontend Engineer')).toBeInTheDocument();
    expect(screen.getByText('TechCo')).toBeInTheDocument();
    expect(screen.getByText('Full Stack Developer')).toBeInTheDocument();
    expect(screen.getByText('StartupInc')).toBeInTheDocument();
  });

  it('shows error message when API call fails', async () => {
    vi.mocked(discoveryApi).mockRejectedValue(new Error('Network error'));
    renderWithRouter(<RunDetail />);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows back link to discovery page', async () => {
    renderWithJobs([makeJob()]);
    await waitFor(() => {
      expect(screen.getByText(/Back to Job Discovery/)).toBeInTheDocument();
    });
    const backLink = screen.getByText(/Back to Job Discovery/);
    expect(backLink.closest('a')).toHaveAttribute('href', '/discovery');
  });

  it('shows "No jobs found" when run has no visible jobs', async () => {
    renderWithJobs([]);
    await waitFor(() => {
      expect(screen.getByText('No jobs found')).toBeInTheDocument();
    });
  });
});

describe('RunDetailPage - Verdict Display', () => {
  it.each([
    { verdict: 'YES', score: 82, label: 'Yes' },
    { verdict: 'STRONG_YES', score: 95, label: 'Strong Yes' },
    { verdict: 'MAYBE', score: 55, label: 'Maybe' },
    { verdict: 'NO', score: 30, label: 'No' },
    { verdict: 'STRONG_NO', score: 12, label: 'Strong No' },
  ])('$verdict verdict displays score $score and label "$label"', async ({ verdict, score, label }) => {
    renderWithJobs([makeJob({ score, verdict })]);
    await waitFor(() => {
      expect(screen.getByText(String(score))).toBeInTheDocument();
    });
    expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
  });

  it('MATCH_FAILED shows label without score', async () => {
    renderWithJobs([makeJob({ title: 'Failed Job', score: null, verdict: 'MATCH_FAILED', match_analysis: null })]);
    await waitFor(() => {
      expect(screen.getByText('Failed Job')).toBeInTheDocument();
    });
    expect(screen.getByText('Match Failed', { exact: true })).toBeInTheDocument();
  });

  it('INSUFFICIENT_DATA shows label without score', async () => {
    renderWithJobs([makeJob({ title: 'Short Job', score: null, verdict: 'INSUFFICIENT_DATA' })]);
    await waitFor(() => {
      expect(screen.getByText('Short Job')).toBeInTheDocument();
    });
    expect(screen.getByText('Insufficient Data', { exact: true })).toBeInTheDocument();
  });

  it('null verdict and null score shows dash', async () => {
    renderWithJobs([makeJob({ title: 'Unscored Job', score: null, verdict: null })]);
    await waitFor(() => {
      expect(screen.getByText('Unscored Job')).toBeInTheDocument();
    });
    expect(screen.getByText('-', { exact: true })).toBeInTheDocument();
  });
});

describe('RunDetailPage - Glassdoor Data', () => {
  it('displays rating, review count, and link', async () => {
    renderWithJobs([makeJob({
      glassdoor_data: { rating: 4.3, reviewCount: 1250, url: 'https://glassdoor.com/toprated' },
    })]);
    await waitFor(() => {
      expect(screen.getByText('4.3 / 5')).toBeInTheDocument();
    });
    expect(screen.getByText('(1,250 reviews)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Glassdoor' })).toHaveAttribute('href', 'https://glassdoor.com/toprated');
  });

  it('displays rating without link when url is null', async () => {
    renderWithJobs([makeJob({
      glassdoor_data: { rating: 2.5, reviewCount: 300, url: null },
    })]);
    await waitFor(() => {
      expect(screen.getByText('2.5 / 5')).toBeInTheDocument();
    });
    expect(screen.getByText('(300 reviews)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Glassdoor' })).not.toBeInTheDocument();
  });

  it('does not show rating section when glassdoor_data is null', async () => {
    renderWithJobs([makeJob({ title: 'No Rating Job', glassdoor_data: null })]);
    await waitFor(() => {
      expect(screen.getByText('No Rating Job')).toBeInTheDocument();
    });
    expect(screen.queryByText('/ 5')).not.toBeInTheDocument();
    expect(screen.queryByText('reviews')).not.toBeInTheDocument();
  });

  it('displays sub-ratings and recommend percent from deep payload', async () => {
    renderWithJobs([makeJob({
      glassdoor_data: {
        rating: 4.0,
        reviewCount: 2168,
        url: 'https://glassdoor.com/wix',
        subRatings: { workLifeBalance: 4.2, cultureAndValues: 4.2, careerOpportunities: 3.7 },
        recommendPercent: 82,
      },
    })]);
    await waitFor(() => {
      expect(screen.getByText('4.0 / 5')).toBeInTheDocument();
    });
    expect(screen.getByText('· 82% recommend')).toBeInTheDocument();
    expect(screen.getByText('WLB')).toBeInTheDocument();
    expect(screen.getByText('Culture')).toBeInTheDocument();
    expect(screen.getByText('Career')).toBeInTheDocument();
    expect(screen.getByText('3.7')).toBeInTheDocument();
    // absent categories are not rendered
    expect(screen.queryByText('Mgmt')).not.toBeInTheDocument();
    expect(screen.queryByText('Comp')).not.toBeInTheDocument();
  });

  it('renders deep payload without an overall rating without crashing', async () => {
    renderWithJobs([makeJob({
      title: 'Deep Only Job',
      glassdoor_data: {
        subRatings: { workLifeBalance: 2.8 },
        recommendPercent: 45,
      },
    })]);
    await waitFor(() => {
      expect(screen.getByText('Deep Only Job')).toBeInTheDocument();
    });
    expect(screen.queryByText(/\/ 5/)).not.toBeInTheDocument();
    expect(screen.getByText('· 45% recommend')).toBeInTheDocument();
    expect(screen.getByText('WLB')).toBeInTheDocument();
    expect(screen.getByText('2.8')).toBeInTheDocument();
  });
});

describe('RunDetailPage - Company News', () => {
  it('collapsible section shows items on click', async () => {
    const user = userEvent.setup();
    renderWithJobs([makeJob({
      company_news: [
        { title: 'BigNews raises $50M', source: 'TechCrunch' },
        { title: 'BigNews expands', source: 'Reuters' },
      ],
    })]);
    await waitFor(() => {
      expect(screen.getByText('Company News (2)')).toBeInTheDocument();
    });

    expect(screen.getByText('BigNews raises $50M')).not.toBeVisible();
    await user.click(screen.getByText('Company News (2)'));
    expect(screen.getByText('BigNews raises $50M')).toBeVisible();
    expect(screen.getByText('TechCrunch', { exact: false })).toBeVisible();
    expect(screen.getByText('BigNews expands')).toBeVisible();
  });

  it('does not show news section when company_news is null', async () => {
    renderWithJobs([makeJob({ title: 'Quiet Job', company_news: null })]);
    await waitFor(() => {
      expect(screen.getByText('Quiet Job')).toBeInTheDocument();
    });
    expect(screen.queryByText('Company News')).not.toBeInTheDocument();
  });
});

describe('RunDetailPage - Honest Assessment', () => {
  it('displays with RTL direction', async () => {
    renderWithJobs([makeJob({
      match_analysis: { honestAssessment: 'Strong match with growth opportunities.' },
    })]);
    await waitFor(() => {
      expect(screen.getByText('Strong match with growth opportunities.')).toBeInTheDocument();
    });
    expect(screen.getByText('Strong match with growth opportunities.')).toHaveAttribute('dir', 'rtl');
  });

  it('does not show assessment block when null', async () => {
    renderWithJobs([makeJob({ title: 'No Assessment Job', match_analysis: null })]);
    await waitFor(() => {
      expect(screen.getByText('No Assessment Job')).toBeInTheDocument();
    });
    expect(screen.queryByText('[dir="rtl"]')).not.toBeInTheDocument();
  });
});

describe('RunDetailPage - Signals (green/red flags) in breakdown panel', () => {
  it('hides flags on the card until the Score Breakdown panel is opened', async () => {
    const user = userEvent.setup();
    renderWithJobs([makeJob({
      match_analysis: { breakdown: {}, recommendation: { greenFlags: ['Excellent tech stack', 'Remote friendly', 'Competitive salary'] } },
    })]);
    await waitFor(() => {
      expect(screen.getByText('Score Breakdown')).toBeInTheDocument();
    });
    // Not on the card before opening
    expect(screen.queryByText('Excellent tech stack')).not.toBeInTheDocument();
    await user.click(screen.getByText('Score Breakdown'));
    expect(screen.getByText('Excellent tech stack')).toBeInTheDocument();
    expect(screen.getByText('Remote friendly')).toBeInTheDocument();
    expect(screen.getByText('Competitive salary')).toBeInTheDocument();
  });

  it('shows red flags in the Signals section once opened', async () => {
    const user = userEvent.setup();
    renderWithJobs([makeJob({
      match_analysis: { breakdown: {}, recommendation: { redFlags: ['No remote option', 'Legacy tech stack'] } },
    })]);
    await waitFor(() => {
      expect(screen.getByText('Score Breakdown')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Score Breakdown'));
    expect(screen.getByText('No remote option')).toBeInTheDocument();
    expect(screen.getByText('Legacy tech stack')).toBeInTheDocument();
  });

  it('shows the enforced review adjustment arithmetic on adjusted components', async () => {
    const user = userEvent.setup();
    renderWithJobs([makeJob({
      match_analysis: {
        breakdown: {
          sustainabilityPaceFit: {
            score: 8,
            maxScore: 35,
            components: [
              { name: 'Pace & Workload', score: 8, maxScore: 20, reason: 'סיבה', reviewAdjustment: { base: 11, delta: -3 } },
              { name: 'Long-term Risk', score: 9, maxScore: 15, reason: 'סיבה' },
            ],
          },
        },
      },
    })]);
    await waitFor(() => {
      expect(screen.getByText('Score Breakdown')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Score Breakdown'));
    expect(screen.getByText(/from employee reviews/)).toBeInTheDocument();
    expect(screen.getByText(/base 11/)).toBeInTheDocument();
    expect(screen.getByText('−3')).toBeInTheDocument();
    // Only the adjusted component carries the annotation
    expect(screen.getAllByText(/from employee reviews/)).toHaveLength(1);
  });

  it('shows both green and red flags in the Signals section once opened', async () => {
    const user = userEvent.setup();
    renderWithJobs([makeJob({
      match_analysis: { breakdown: {}, recommendation: { greenFlags: ['Good benefits'], redFlags: ['Long commute'] } },
    })]);
    await waitFor(() => {
      expect(screen.getByText('Score Breakdown')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Score Breakdown'));
    expect(screen.getByText('Good benefits')).toBeInTheDocument();
    expect(screen.getByText('Long commute')).toBeInTheDocument();
  });

  it('renders neither when match_analysis is null', async () => {
    renderWithJobs([makeJob({ title: 'Plain Job', match_analysis: null })]);
    await waitFor(() => {
      expect(screen.getByText('Plain Job')).toBeInTheDocument();
    });
  });
});

describe('RunDetailPage - Action Buttons', () => {
  it('shows View Job link with correct href and target', async () => {
    renderWithJobs([makeJob({ job_url: 'https://linkedin.com/jobs/123' })]);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'View Job' })).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: 'View Job' });
    expect(link).toHaveAttribute('href', 'https://linkedin.com/jobs/123');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('shows Rescore button for jobs with long description', async () => {
    renderWithJobs([makeJob({
      description: 'A '.repeat(30) + 'long description over 50 chars for rescore eligibility.',
    })]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Rescore' })).toBeInTheDocument();
    });
  });

  it('hides Rescore button for jobs with short description', async () => {
    renderWithJobs([makeJob({ title: 'Short Job', description: 'Too short' })]);
    await waitFor(() => {
      expect(screen.getByText('Short Job')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Rescore' })).not.toBeInTheDocument();
  });

  it('shows Save to Tracker for scored unsaved jobs', async () => {
    renderWithJobs([makeJob({ score: 80, saved_to_tracker: false })]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save to Tracker' })).toBeInTheDocument();
    });
  });

  it('shows Saved badge and hides Save button for already-saved jobs', async () => {
    renderWithJobs([makeJob({ score: 85, saved_to_tracker: true })]);
    await waitFor(() => {
      expect(screen.getByText('Saved', { exact: true })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Save to Tracker' })).not.toBeInTheDocument();
  });

  it('shows Dismiss button on job cards', async () => {
    renderWithJobs([makeJob()]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });
  });

  it('hides Save to Tracker for unscored jobs', async () => {
    renderWithJobs([makeJob({ title: 'Unscored', score: null, verdict: 'MATCH_FAILED' })]);
    await waitFor(() => {
      expect(screen.getByText('Unscored')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Save to Tracker' })).not.toBeInTheDocument();
  });
});

describe('RunDetailPage - Hidden Jobs', () => {
  it('hides duplicate jobs', async () => {
    renderWithJobs([
      makeJob({ title: 'Visible Job', is_duplicate: false }),
      makeJob({ title: 'Duplicate Job', is_duplicate: true }),
    ]);
    await waitFor(() => {
      expect(screen.getByText('Visible Job')).toBeInTheDocument();
    });
    expect(screen.queryByText('Duplicate Job')).not.toBeInTheDocument();
  });

  it('hides dismissed jobs', async () => {
    renderWithJobs([
      makeJob({ title: 'Active Job', dismissed: false }),
      makeJob({ title: 'Dismissed Job', dismissed: true }),
    ]);
    await waitFor(() => {
      expect(screen.getByText('Active Job')).toBeInTheDocument();
    });
    expect(screen.queryByText('Dismissed Job')).not.toBeInTheDocument();
  });

  it('shows "No jobs found" when all jobs are hidden', async () => {
    renderWithJobs([
      makeJob({ title: 'Dup', is_duplicate: true }),
      makeJob({ title: 'Dismissed', dismissed: true }),
    ]);
    await waitFor(() => {
      expect(screen.getByText('No jobs found')).toBeInTheDocument();
    });
  });
});

describe('RunDetailPage - Failed Scoring Banner', () => {
  it('shows rescore all failed banner when there are failed jobs', async () => {
    renderWithJobs([
      makeJob({ score: 80, verdict: 'YES' }),
      makeJob({ score: null, verdict: 'MATCH_FAILED', description: 'A '.repeat(30) + 'long enough.' }),
      makeJob({ score: null, verdict: 'MATCH_FAILED', description: 'A '.repeat(30) + 'another long.' }),
    ]);
    await waitFor(() => {
      expect(screen.getByText(/2 jobs failed scoring/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Rescore All Failed' })).toBeInTheDocument();
  });

  it('hides banner when no jobs failed', async () => {
    renderWithJobs([makeJob({ score: 80, verdict: 'YES' })]);
    await waitFor(() => {
      expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Rescore All Failed' })).not.toBeInTheDocument();
  });

  it('hides banner during active runs', async () => {
    renderWithJobs(
      [makeJob({ score: null, verdict: 'MATCH_FAILED', description: 'A '.repeat(30) + 'long enough.' })],
      { status: 'scoring' },
    );
    await waitFor(() => {
      expect(screen.getByText('Processing... the page will update automatically')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Rescore All Failed' })).not.toBeInTheDocument();
  });
});

describe('RunDetailPage - Multiple Jobs Ordering', () => {
  it('displays jobs in the order received from API', async () => {
    renderWithJobs([
      makeJob({ title: 'High Score Job', score: 95, verdict: 'STRONG_YES' }),
      makeJob({ title: 'Mid Score Job', score: 60, verdict: 'MAYBE' }),
      makeJob({ title: 'Low Score Job', score: 30, verdict: 'NO' }),
    ]);
    await waitFor(() => {
      expect(screen.getByText('High Score Job')).toBeInTheDocument();
    });
    const cards = screen.getAllByText(/Score Job/);
    expect(cards[0]).toHaveTextContent('High Score Job');
    expect(cards[1]).toHaveTextContent('Mid Score Job');
    expect(cards[2]).toHaveTextContent('Low Score Job');
  });
});
