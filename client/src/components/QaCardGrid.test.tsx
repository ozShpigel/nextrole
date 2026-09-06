import { useState } from 'react';
import { screen, render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QaCardGrid } from './QaCardGrid';
import type { QaEntry } from '../lib/types';

const ENTRIES: QaEntry[] = [
  { question: 'Tell me about yourself', answer: 'Intro answer', categories: [], topic: '' },
  { question: 'Explain the Payoneer project', answer: 'Payoneer answer', categories: [], topic: 'Payoneer project' },
  { question: 'Biggest challenge there?', answer: 'Challenge answer', categories: [], topic: 'Payoneer project' },
  { question: 'Untagged question', answer: 'Untagged answer' },
];

/* The card grid is controlled — hold its entries like the page does. */
function Harness({ initial, onChange }: { initial: QaEntry[]; onChange?: (next: QaEntry[]) => void }) {
  const [entries, setEntries] = useState(initial);
  return (
    <QaCardGrid
      entries={entries}
      onChange={(next) => {
        setEntries(next);
        onChange?.(next);
      }}
    />
  );
}

/* Rows are collapsed by default: clicking the row toggles the inline answer. */
function toggleRow(name: string | RegExp): Promise<void> {
  return userEvent.click(screen.getByRole('button', { name }));
}

function searchInput(): HTMLElement {
  return screen.getByRole('textbox', { name: /search questions/i });
}

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView; stub it so the add() scroll
  // effect doesn't throw, and so we can assert it fires.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('QaCardGrid', () => {
  it('renders every question as a collapsed row, with topic labels shown, answers hidden until expanded', () => {
    render(<Harness initial={ENTRIES} />);

    expect(screen.getByText('Tell me about yourself')).toBeInTheDocument();
    expect(screen.getByText('Explain the Payoneer project')).toBeInTheDocument();
    expect(screen.getByText('Biggest challenge there?')).toBeInTheDocument();
    expect(screen.getByText('Untagged question')).toBeInTheDocument();

    expect(screen.queryByText('Intro answer')).not.toBeInTheDocument();
    expect(screen.queryByText('Payoneer answer')).not.toBeInTheDocument();

    // One topic label per tagged row (distinct from the "Payoneer project (2)" filter chip).
    expect(screen.getAllByText('Payoneer project').length).toBe(2);
  });

  it('expands a row to reveal its answer inline, and collapsing one row leaves others expanded', async () => {
    render(<Harness initial={ENTRIES} />);

    await toggleRow(/tell me about yourself/i);
    expect(screen.getByText('Intro answer')).toBeInTheDocument();

    await toggleRow(/explain the payoneer project/i);
    expect(screen.getByText('Payoneer answer')).toBeInTheDocument();
    expect(screen.getByText('Intro answer')).toBeInTheDocument();

    await toggleRow(/tell me about yourself/i);
    expect(screen.queryByText('Intro answer')).not.toBeInTheDocument();
    expect(screen.getByText('Payoneer answer')).toBeInTheDocument();
  });

  it('shows Edit only once a row is expanded; Done returns to the row with the update visible', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();

    await toggleRow(/tell me about yourself/i);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Tell me about yourself');
    expect(screen.getByRole('textbox', { name: 'Answer' })).toHaveValue('Intro answer');

    const answer = screen.getByRole('textbox', { name: 'Answer' });
    await userEvent.type(answer, ' updated');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ answer: 'Intro answer updated' })]),
    );

    await userEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(screen.queryByRole('textbox', { name: 'Question' })).not.toBeInTheDocument();
    expect(screen.getByText('Intro answer updated')).toBeInTheDocument();
  });

  it('tags a question with an existing topic chip, or a new topic via + Topic', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    await toggleRow(/untagged question/i);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    // One click on an existing topic's chip assigns it.
    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ question: 'Untagged question', topic: 'Payoneer project' })]),
    );
    expect(screen.getByRole('button', { name: 'Payoneer project', pressed: true })).toBeInTheDocument();

    // "+ Topic" opens an inline input; Enter commits the new topic.
    await userEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New topic' }), 'Self presentation{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ question: 'Untagged question', topic: 'Self presentation' })]),
    );
  });

  it('filtering by topic narrows the list to just that set', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)' }));
    expect(screen.getByText('Explain the Payoneer project')).toBeInTheDocument();
    expect(screen.getByText('Biggest challenge there?')).toBeInTheDocument();
    expect(screen.queryByText('Tell me about yourself')).not.toBeInTheDocument();
    expect(screen.queryByText('Untagged question')).not.toBeInTheDocument();

    // Clicking the active topic chip clears the filter and returns to the full set.
    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)', pressed: true }));
    expect(screen.getByText('Tell me about yourself')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All (4)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('exits edit mode when a topic filter hides the row being edited', async () => {
    render(<Harness initial={ENTRIES} />);

    await toggleRow(/tell me about yourself/i);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Tell me about yourself');

    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)' }));
    expect(screen.queryByRole('textbox', { name: 'Question' })).not.toBeInTheDocument();
  });

  it('search filters by question and answer text, case-insensitively', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.type(searchInput(), 'CHALLENGE');
    expect(screen.getByText('Biggest challenge there?')).toBeInTheDocument();
    expect(screen.queryByText('Tell me about yourself')).not.toBeInTheDocument();
    expect(screen.queryByText('Explain the Payoneer project')).not.toBeInTheDocument();

    await userEvent.clear(searchInput());
    await userEvent.type(searchInput(), 'intro'); // matches the answer text, not the question
    expect(screen.getByText('Tell me about yourself')).toBeInTheDocument();
    expect(screen.queryByText('Biggest challenge there?')).not.toBeInTheDocument();
  });

  it('the search input can be cleared with its own clear button', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.type(searchInput(), 'intro');
    expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /clear search/i }));
    expect(searchInput()).toHaveValue('');
    expect(screen.getByText('Explain the Payoneer project')).toBeInTheDocument();
  });

  it('combines search with an active topic filter, and shows a no-matches state with a way to reset', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)' }));
    await userEvent.type(searchInput(), 'challenge');
    expect(screen.getByText('Biggest challenge there?')).toBeInTheDocument();
    expect(screen.queryByText('Explain the Payoneer project')).not.toBeInTheDocument();

    await userEvent.clear(searchInput());
    await userEvent.type(searchInput(), 'nonexistent');
    expect(screen.getByText(/no questions match/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(searchInput()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'All (4)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Tell me about yourself')).toBeInTheDocument();
  });

  it('closes edit mode when a search query hides the row being edited', async () => {
    render(<Harness initial={ENTRIES} />);

    await toggleRow(/tell me about yourself/i);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Tell me about yourself');

    await userEvent.type(searchInput(), 'payoneer');
    expect(screen.queryByRole('textbox', { name: 'Question' })).not.toBeInTheDocument();
  });

  it('Add question opens a new entry in edit mode, pre-tagged with the active topic filter, and scrolls it into view', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)' }));
    await userEvent.click(screen.getByRole('button', { name: /add question/i }));

    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Payoneer project', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payoneer project (3)' })).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('reordering swaps an entry with its same-topic sibling', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    await toggleRow(/biggest challenge there/i);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Move up' }));

    const reordered = onChange.mock.lastCall?.[0] as QaEntry[];
    expect(reordered.map((e) => e.question)).toEqual([
      'Tell me about yourself',
      'Biggest challenge there?',
      'Explain the Payoneer project',
      'Untagged question',
    ]);
  });

  it('deleting a row removes it and closes its edit form', async () => {
    render(<Harness initial={ENTRIES} />);

    await toggleRow(/tell me about yourself/i);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove question' }));

    expect(screen.queryByText('Tell me about yourself')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Question' })).not.toBeInTheDocument();
    expect(screen.getByText('Explain the Payoneer project')).toBeInTheDocument();
  });

  it('drops a topic filter chip once its last question is deleted', async () => {
    render(
      <Harness
        initial={[
          { question: 'Only topical question', answer: 'A', categories: [], topic: 'Payoneer project' },
          { question: 'General question', answer: 'B', categories: [], topic: '' },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Payoneer project (1)' })).toBeInTheDocument();

    await toggleRow(/only topical question/i);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove question' }));

    expect(screen.queryByRole('button', { name: /payoneer project/i })).not.toBeInTheDocument();
    expect(screen.getByText('General question')).toBeInTheDocument();
  });

  it('shows the empty state when there are no questions', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/no questions yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /all \(/i })).not.toBeInTheDocument();
  });

  it('dedupes topic chips case-insensitively, keeping the first-seen casing', () => {
    render(
      <Harness
        initial={[
          { question: 'Q1', answer: 'A1', categories: [], topic: 'Payoneer Project' },
          { question: 'Q2', answer: 'A2', categories: [], topic: 'payoneer project' },
        ]}
      />,
    );
    // Only one filter chip for the topic, using the first-seen casing (row
    // toggle buttons also contain the topic text, so scope to the filter group).
    const filterGroup = screen.getByRole('group', { name: /filter questions by topic/i });
    expect(within(filterGroup).getAllByRole('button', { name: /payoneer project/i }).length).toBe(1);
    expect(within(filterGroup).getByRole('button', { name: 'Payoneer Project (2)' })).toBeInTheDocument();

    // Both rows render at once now — no stepping required to see the second.
    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.getByText('Q2')).toBeInTheDocument();
  });
});
