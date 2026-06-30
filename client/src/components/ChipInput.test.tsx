import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipInput } from './ChipInput';

// Controlled wrapper so the component behaves like it does in the app.
function Harness({ initial = [] as string[], suggestions }: { initial?: string[]; suggestions?: string[] }) {
  const [value, setValue] = useState<string[]>(initial);
  return <ChipInput value={value} onChange={setValue} placeholder="Add item" ariaLabel="Add item" suggestions={suggestions} />;
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
});
