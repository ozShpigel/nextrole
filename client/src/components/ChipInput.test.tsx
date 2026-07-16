import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipInput } from './ChipInput';

// Controlled wrapper so the component behaves like it does in the app.
function Harness({ initial = [] as string[], suggestions, max }: { initial?: string[]; suggestions?: string[]; max?: number }) {
  const [value, setValue] = useState<string[]>(initial);
  return <ChipInput value={value} onChange={setValue} placeholder="Add item" ariaLabel="Add item" suggestions={suggestions} max={max} />;
}

describe('ChipInput', () => {
  it('adds an item on Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Add item');
    await user.type(input, 'React{Enter}');
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('adds multiple items from a comma-separated paste', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Add item');
    // Typing a comma commits the pending token.
    await user.type(input, 'Go, Rust, ');
    await user.type(input, '{Enter}');
    expect(screen.getByText('Go')).toBeInTheDocument();
    expect(screen.getByText('Rust')).toBeInTheDocument();
  });

  it('de-dupes case-insensitively', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['React']} />);
    const input = screen.getByLabelText('Add item');
    await user.type(input, 'react{Enter}');
    expect(screen.getAllByText(/react/i)).toHaveLength(1);
  });

  it('removes an item via its × button', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['React', 'Vue']} />);
    await user.click(screen.getByRole('button', { name: 'Remove React' }));
    expect(screen.queryByText('React')).not.toBeInTheDocument();
    expect(screen.getByText('Vue')).toBeInTheDocument();
  });

  it('removes the last chip on Backspace when the input is empty', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['React', 'Vue']} />);
    const input = screen.getByLabelText('Add item');
    input.focus();
    await user.keyboard('{Backspace}');
    expect(screen.queryByText('Vue')).not.toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
  });

  it('adds a quick-add suggestion on click and hides it once present', async () => {
    const user = userEvent.setup();
    render(<Harness suggestions={['Go', 'Rust']} />);
    await user.click(screen.getByRole('button', { name: '+ Go' }));
    // It moves from a suggestion to a chip, so the suggestion button disappears.
    expect(screen.queryByRole('button', { name: '+ Go' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Go' })).toBeInTheDocument();
    // The other suggestion stays available.
    expect(screen.getByRole('button', { name: '+ Rust' })).toBeInTheDocument();
  });

  describe('max cap', () => {
    it('hides the input and quick-adds at the cap and shows the hint', () => {
      render(<Harness initial={['one', 'two', 'three']} max={3} suggestions={['Go']} />);
      expect(screen.queryByLabelText('Add item')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '+ Go' })).not.toBeInTheDocument();
      expect(screen.getByText('3 of 3 — remove one to add another')).toBeInTheDocument();
    });

    it('truncates a comma-separated paste at the cap', async () => {
      const user = userEvent.setup();
      render(<Harness initial={['one']} max={3} />);
      await user.type(screen.getByLabelText('Add item'), 'two, three, four{Enter}');
      expect(screen.getByText('two')).toBeInTheDocument();
      expect(screen.getByText('three')).toBeInTheDocument();
      expect(screen.queryByText('four')).not.toBeInTheDocument();
    });

    it('over-the-cap values (legacy data) show the trim hint and stay removable', async () => {
      const user = userEvent.setup();
      render(<Harness initial={['one', 'two', 'three', 'four']} max={3} />);
      expect(screen.getByText('Over the limit — remove down to 3')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Remove four' }));
      expect(screen.getByText('3 of 3 — remove one to add another')).toBeInTheDocument();
    });
  });
});
