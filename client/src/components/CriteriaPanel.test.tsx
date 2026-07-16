import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/render';
import { CriteriaSection, CriteriaCard, CriteriaForm } from './CriteriaPanel';
import { discoveryApi } from '../lib/api';

vi.mock('../lib/api', () => ({
  discoveryApi: vi.fn(),
  api: vi.fn(),
}));

const noop = () => {};

function makeCriteria(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: 'Test Criteria',
    job_titles: ['Software Engineer'],
    locations: ['Tel Aviv'],
    site_names: ['linkedin'],
    results_wanted: 15,
    hours_old: 72,
    country: 'Israel',
    is_remote: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CriteriaSection - Empty State', () => {
  it('shows empty state message and create button when no criteria exist', () => {
    renderWithRouter(
      <CriteriaSection criteria={[]} onEdit={noop} onDelete={noop} onRun={noop} onNew={noop} />,
    );
    expect(screen.getByText('No search criteria')).toBeInTheDocument();
    expect(screen.getByText('Define your first criteria to start automatically scanning jobs from LinkedIn and Indeed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Create New Criteria' })).toBeInTheDocument();
  });
});

describe('CriteriaSection - Multiple Cards', () => {
  it('displays multiple criteria cards', () => {
    const criteria = [
      makeCriteria({ name: 'Frontend Jobs', job_titles: ['Frontend Developer'] }),
      makeCriteria({ name: 'Backend Jobs', job_titles: ['Backend Developer'] }),
    ];
    renderWithRouter(
      <CriteriaSection criteria={criteria} onEdit={noop} onDelete={noop} onRun={noop} onNew={noop} />,
    );
    expect(screen.getByText('Frontend Jobs')).toBeInTheDocument();
    expect(screen.getByText('Backend Jobs')).toBeInTheDocument();
  });

  it('each card has a Run Search button', () => {
    const criteria = [makeCriteria({ name: 'A' }), makeCriteria({ name: 'B' })];
    renderWithRouter(
      <CriteriaSection criteria={criteria} onEdit={noop} onDelete={noop} onRun={noop} onNew={noop} />,
    );
    expect(screen.getAllByRole('button', { name: 'Run Search →' })).toHaveLength(2);
  });
});

describe('CriteriaCard - Display', () => {
  it('shows all relevant info', () => {
    const criteria = makeCriteria({
      name: 'Full Info Criteria',
      job_titles: ['ML Engineer', 'Data Scientist'],
      locations: ['Haifa', 'Remote'],
      site_names: ['linkedin', 'indeed'],
    });
    renderWithRouter(
      <CriteriaCard criteria={criteria} index={0} onEdit={noop} onDelete={noop} onRun={noop} />,
    );
    expect(screen.getByText('Full Info Criteria')).toBeInTheDocument();
    expect(screen.getByText('ML Engineer')).toBeInTheDocument();
    expect(screen.getByText('Data Scientist')).toBeInTheDocument();
    expect(screen.getByText('Haifa · Remote')).toBeInTheDocument();
    expect(screen.getByText('linkedin · indeed')).toBeInTheDocument();
    // The min-score threshold meter was removed with the vestigial field.
    expect(screen.queryByText('Threshold')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Search →' })).toBeInTheDocument();
  });
});

describe('CriteriaCard - Demo mode', () => {
  it('disables the mutating buttons with an explanation instead of failing on click', async () => {
    const { api } = await import('../lib/api');
    vi.mocked(api).mockResolvedValue({ demoMode: true });
    renderWithRouter(
      <CriteriaCard criteria={makeCriteria()} index={0} onEdit={noop} onDelete={noop} onRun={noop} />,
    );
    const run = await screen.findByRole('button', { name: 'Run Search — disabled in demo' });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute('title', 'Disabled in the read-only demo');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

describe('CriteriaForm - Validation', () => {
  it('create button is disabled when name is empty', () => {
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('create button is disabled when job titles are empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    await user.type(screen.getByPlaceholderText('e.g. "Senior Backend .NET"'), 'Test');
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('create button is disabled when no sites are selected', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    await user.type(screen.getByPlaceholderText('e.g. "Senior Backend .NET"'), 'Test');
    await user.type(screen.getByPlaceholderText(/Senior Backend Engineer/), 'Engineer');
    // Deselect the default linkedin
    await user.click(screen.getByRole('button', { name: 'LinkedIn' }));
    expect(screen.getByText('Select at least one site')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('create button is enabled with valid name and job titles', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    await user.type(screen.getByPlaceholderText('e.g. "Senior Backend .NET"'), 'My Search');
    await user.type(screen.getByPlaceholderText(/Senior Backend Engineer/), 'Software Engineer');
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });
});

describe('CriteriaForm - Search budget', () => {
  it('shows the live titles × locations search count', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    await user.type(screen.getByPlaceholderText(/Senior Backend Engineer/), 'A{enter}B{enter}C');
    await user.type(screen.getByPlaceholderText(/Tel Aviv/), 'Tel Aviv{enter}Remote');
    expect(screen.getByText('6 searches per run')).toBeInTheDocument();
  });

  it('disables Create and warns when titles × locations exceeds the budget', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    await user.type(screen.getByPlaceholderText('e.g. "Senior Backend .NET"'), 'Big Search');
    // 7 titles × 2 locations = 14 searches > 12
    await user.type(screen.getByPlaceholderText(/Senior Backend Engineer/), 'A{enter}B{enter}C{enter}D{enter}E{enter}F{enter}G');
    await user.type(screen.getByPlaceholderText(/Tel Aviv/), 'Tel Aviv{enter}Remote');
    expect(screen.getByText('14 searches per run')).toBeInTheDocument();
    expect(screen.getByText(/over the limit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});

describe('CriteriaForm - Cancel', () => {
  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('CriteriaForm - Suggestion Chips', () => {
  it('clicking a job title suggestion adds it to the textarea', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    await user.click(screen.getByRole('button', { name: '+ Software Engineer' }));
    expect(screen.getByPlaceholderText(/Senior Backend Engineer/)).toHaveValue('Software Engineer');
  });

  it('clicking a location suggestion adds it to the textarea', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    await user.click(screen.getByRole('button', { name: '+ Tel Aviv' }));
    const textareas = screen.getAllByRole('textbox');
    // textareas: [0]=name input, [1]=job titles, [2]=locations
    expect(textareas[2]).toHaveValue('Tel Aviv');
  });

  it('clicking multiple suggestion chips appends each on a new line', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    await user.click(screen.getByRole('button', { name: '+ Software Engineer' }));
    await user.click(screen.getByRole('button', { name: '+ DevOps Engineer' }));
    expect(screen.getByPlaceholderText(/Senior Backend Engineer/)).toHaveValue('Software Engineer\nDevOps Engineer');
  });

  it('used suggestion chip disappears', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CriteriaForm onSave={noop} onCancel={noop} />);
    await user.click(screen.getByRole('button', { name: '+ Software Engineer' }));
    expect(screen.queryByRole('button', { name: '+ Software Engineer' })).not.toBeInTheDocument();
  });
});

describe('CriteriaForm - Edit Mode', () => {
  it('shows pre-filled data in edit mode', () => {
    const criteria = makeCriteria({
      name: 'Original Criteria',
      job_titles: ['Backend Developer', 'Full Stack Developer'],
      locations: ['Tel Aviv'],
    });
    renderWithRouter(<CriteriaForm initial={criteria} onSave={noop} onCancel={noop} />);
    expect(screen.getByText('Edit Criteria')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. "Senior Backend .NET"')).toHaveValue('Original Criteria');
    expect(screen.getByPlaceholderText(/Senior Backend Engineer/)).toHaveValue('Backend Developer\nFull Stack Developer');
  });
});
