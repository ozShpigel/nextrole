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

/* Prev/Next are hover-reveal chevrons overlaid on the card, only rendered
 * when a neighboring card actually exists at that end of the filtered set
 * (absent, not disabled, at a boundary). The position badge is likewise
 * only rendered once there's more than one card to step through. */
function next(): Promise<void> {
  return userEvent.click(screen.getByRole('button', { name: 'Next question' }));
}
function prev(): Promise<void> {
  return userEvent.click(screen.getByRole('button', { name: 'Previous question' }));
}
function position(): HTMLElement {
  return screen.getByText(/^\d+ \/ \d+$/);
}

describe('QaCardGrid', () => {
  it('shows one card at a time, with Previous/Next stepping through and a position indicator', async () => {
    render(<Harness initial={ENTRIES} />);

    // First entry shown by default; the rest are not in the document yet.
    expect(screen.getByText('Tell me about yourself')).toBeInTheDocument();
    expect(screen.getByText('Intro answer')).toBeInTheDocument();
    expect(screen.queryByText('Explain the Payoneer project')).not.toBeInTheDocument();
    expect(position()).toHaveTextContent('1 / 4');
    expect(screen.queryByRole('button', { name: 'Previous question' })).not.toBeInTheDocument();

    await next();
    expect(screen.getByText('Explain the Payoneer project')).toBeInTheDocument();
    expect(screen.queryByText('Tell me about yourself')).not.toBeInTheDocument();
    expect(position()).toHaveTextContent('2 / 4');

    await prev();
    expect(screen.getByText('Tell me about yourself')).toBeInTheDocument();
    expect(position()).toHaveTextContent('1 / 4');
  });

  it('hides the Next button on the last card', async () => {
    render(<Harness initial={ENTRIES} />);

    for (let i = 0; i < ENTRIES.length - 1; i++) {
      await next();
    }
    expect(position()).toHaveTextContent('4 / 4');
    expect(screen.queryByRole('button', { name: 'Next question' })).not.toBeInTheDocument();
  });

  it('shows an Edit button on the visible card, revealing inputs, and Done returns to the card face', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Tell me about yourself');
    expect(screen.getByRole('textbox', { name: 'Answer' })).toHaveValue('Intro answer');

    const answer = screen.getByRole('textbox', { name: 'Answer' });
    await userEvent.type(answer, ' updated');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ answer: 'Intro answer updated' })]),
    );

    await userEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Intro answer updated')).toBeInTheDocument();
  });

  it('tags a question with an existing topic chip, or a new topic via + Topic', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    // Step to the untagged question (last one).
    for (let i = 0; i < 3; i++) {
      await next();
    }
    expect(screen.getByText('Untagged question')).toBeInTheDocument();

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

  it('filtering by topic narrows Previous/Next to just that set, starting from the first match', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)' }));
    expect(screen.getByText('Explain the Payoneer project')).toBeInTheDocument();
    expect(position()).toHaveTextContent('1 / 2');

    await next();
    expect(screen.getByText('Biggest challenge there?')).toBeInTheDocument();
    expect(position()).toHaveTextContent('2 / 2');
    expect(screen.queryByRole('button', { name: 'Next question' })).not.toBeInTheDocument();

    // Clicking the active topic chip clears the filter and returns to the full set.
    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)', pressed: true }));
    expect(position()).not.toHaveTextContent('4 / 4'); // position resets, doesn't jump to old length
    expect(screen.getByRole('button', { name: 'All (4)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('exits edit mode when a topic filter hides the card being edited', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('Tell me about yourself');

    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)' }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Add question opens a new entry in edit mode, pre-tagged with the active topic filter', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)' }));
    await userEvent.click(screen.getByRole('button', { name: /add question/i }));

    expect(screen.getByRole('textbox', { name: 'Question' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Payoneer project', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Payoneer project (3)' })).toBeInTheDocument();
  });

  it('reordering swaps an entry with its same-topic sibling', async () => {
    const onChange = vi.fn();
    render(<Harness initial={ENTRIES} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Payoneer project (2)' }));
    // "Biggest challenge there?" is the second Payoneer-project-tagged entry.
    await next();
    expect(screen.getByText('Biggest challenge there?')).toBeInTheDocument();

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

  it('deleting the visible card removes it, closes the form, and steps to a neighbor', async () => {
    render(<Harness initial={ENTRIES} />);

    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove question' }));

    expect(screen.queryByText('Tell me about yourself')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // Falls forward onto what was the second entry.
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

  it('dedupes topic chips case-insensitively, keeping the first-seen casing', async () => {
    render(
      <Harness
        initial={[
          { question: 'Q1', answer: 'A1', categories: [], topic: 'Payoneer Project' },
          { question: 'Q2', answer: 'A2', categories: [], topic: 'payoneer project' },
        ]}
      />,
    );
    // Only one chip for the topic, using the first-seen casing.
    expect(screen.getAllByRole('button', { name: /payoneer project/i }).length).toBe(1);
    expect(screen.getByRole('button', { name: 'Payoneer Project (2)' })).toBeInTheDocument();

    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(screen.queryByText('Q2')).not.toBeInTheDocument();
    await next();
    expect(screen.getByText('Q2')).toBeInTheDocument();
  });
});
