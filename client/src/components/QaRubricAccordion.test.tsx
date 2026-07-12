import { useState } from 'react';
import { screen, render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QaRubricAccordion } from './QaRubricAccordion';
import type { QaEntry } from '../lib/types';

const ENTRIES: QaEntry[] = [
  { question: 'Tell me about yourself', answer: 'Intro answer', categories: ['HR'], topic: '' },
  { question: 'Explain the Payoneer project', answer: 'Payoneer answer', categories: ['Technical'], topic: 'Payoneer project' },
  { question: 'Biggest challenge there?', answer: 'Challenge answer', categories: ['HR', 'Technical'], topic: 'Payoneer project' },
  { question: 'Untagged question', answer: 'Untagged answer' },
];

/* The accordion is controlled — hold its entries like the page does. */
function Harness({ initial, onChange }: { initial: QaEntry[]; onChange?: (next: QaEntry[]) => void }) {
  const [entries, setEntries] = useState(initial);
  return (
    <QaRubricAccordion
      entries={entries}
      onChange={(next) => {
        setEntries(next);
        onChange?.(next);
      }}
    />
  );
}

describe('QaRubricAccordion', () => {
  it('renders questions collapsed under topic groups, answers hidden', () => {
    render(<Harness initial={ENTRIES} />);

    expect(screen.getByText('Payoneer project')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();

    for (const e of ENTRIES) {
      expect(screen.getByText(e.question)).toBeInTheDocument();
      expect(screen.queryByText(e.answer)).not.toBeInTheDocument();
    }

    // Rows without categories show no stamp at all.
    expect(screen.queryByText('Untagged')).not.toBeInTheDocument();
  });

  it('expands one question at a time with a read-only answer and an Edit button', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: /tell me about yourself/i }));
    expect(screen.getByText('Intro answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    // Opening another closes the first.
    await userEvent.click(screen.getByRole('button', { name: /explain the payoneer project/i }));
    expect(screen.getByText('Payoneer answer')).toBeInTheDocument();
    expect(screen.queryByText('Intro answer')).not.toBeInTheDocument();
  });

  it('Edit reveals inputs, edits flow through onChange, Done returns to read view', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /tell me about yourself/i }));
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    const answer = screen.getByRole('textbox', { name: 'Answer' });
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Tell me about yourself');
    // Existing topics render as one-click chips, plus the add-new affordance.
    expect(screen.getByRole('button', { name: 'Payoneer project', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add topic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove question' })).toBeInTheDocument();

    await userEvent.type(answer, ' updated');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ answer: 'Intro answer updated' })]),
    );

    await userEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Intro answer updated')).toBeInTheDocument();
  });

  it('toggling a category chip updates the entry', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /untagged question/i }));
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    const behavioral = screen.getByRole('button', { name: 'Behavioral', pressed: false });
    await userEvent.click(behavioral);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ question: 'Untagged question', categories: ['Behavioral'] })]),
    );
  });

  it('tags a question with an existing topic chip, or a new topic via + Topic', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /untagged question/i }));
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    // One click on an existing topic's chip assigns it.
    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ question: 'Untagged question', topic: 'Payoneer project' })]),
    );
    expect(screen.getByRole('button', { name: 'Payoneer project', pressed: true })).toBeInTheDocument();

    // "+ Topic" opens an inline input; Enter commits the new topic.
    await userEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New topic' }), 'Career{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ question: 'Untagged question', topic: 'Career' })]),
    );
  });

  it('filters by category, showing multi-tagged questions under each of their tags', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: 'HR (2)' }));
    expect(screen.getByText('Tell me about yourself')).toBeInTheDocument();
    expect(screen.getByText('Biggest challenge there?')).toBeInTheDocument();
    expect(screen.queryByText('Explain the Payoneer project')).not.toBeInTheDocument();
    expect(screen.queryByText('Untagged question')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Technical (2)' }));
    expect(screen.getByText('Biggest challenge there?')).toBeInTheDocument();
    expect(screen.getByText('Explain the Payoneer project')).toBeInTheDocument();
    expect(screen.queryByText('Tell me about yourself')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'All (4)' }));
    expect(screen.getByText('Untagged question')).toBeInTheDocument();
  });

  it('collapses an open question when the new filter hides it, and disables reorder while filtered', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: /explain the payoneer project/i }));
    expect(screen.getByText('Payoneer answer')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'HR (2)' }));
    expect(screen.queryByText('Payoneer answer')).not.toBeInTheDocument();

    // Reorder is ambiguous over a filtered projection — disabled.
    await userEvent.click(screen.getByRole('button', { name: /biggest challenge there/i }));
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('Add question opens a new entry in edit mode, pre-tagged with the active filter', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: 'HR (2)' }));
    await userEvent.click(screen.getByRole('button', { name: /add question/i }));

    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'HR', pressed: true })).toBeInTheDocument();
    // The new HR-tagged entry stays visible under the active filter.
    expect(screen.getByRole('button', { name: 'HR (3)' })).toBeInTheDocument();
  });

  it('reordering swaps an entry with its group sibling', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    // "Biggest challenge there?" is the second row of the Payoneer group.
    await userEvent.click(screen.getByRole('button', { name: /biggest challenge there/i }));
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Move up' }));

    const next = onChange.mock.lastCall?.[0] as QaEntry[];
    expect(next.map((e) => e.question)).toEqual([
      'Tell me about yourself',
      'Biggest challenge there?',
      'Explain the Payoneer project',
      'Untagged question',
    ]);
  });

  it('deleting the open question closes the accordion and removes it', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: /untagged question/i }));
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove question' }));

    expect(screen.queryByText('Untagged question')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // "Tell me about yourself" (topic-less) still lives in General.
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('hides a topic group header when its last question is deleted', async () => {
    render(
      <Harness
        initial={[
          { question: 'Only topical question', answer: 'A', categories: [], topic: 'Payoneer project' },
          { question: 'General question', answer: 'B', categories: [], topic: '' },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /only topical question/i }));
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove question' }));

    expect(screen.queryByText('Payoneer project')).not.toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('shows the empty state when there are no questions', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/no questions yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /all \(/i })).not.toBeInTheDocument();
  });

  it('groups topics case-insensitively under the first-seen casing', () => {
    render(
      <Harness
        initial={[
          { question: 'Q1', answer: 'A1', categories: [], topic: 'Payoneer Project' },
          { question: 'Q2', answer: 'A2', categories: [], topic: 'payoneer project' },
        ]}
      />,
    );
    expect(screen.getByText('Payoneer Project')).toBeInTheDocument();
    expect(screen.queryByText('payoneer project')).not.toBeInTheDocument();
    const group = screen.getByText('Payoneer Project').closest('div')!.parentElement!;
    expect(within(group).getByText('Q1')).toBeInTheDocument();
    expect(within(group).getByText('Q2')).toBeInTheDocument();
  });
});
