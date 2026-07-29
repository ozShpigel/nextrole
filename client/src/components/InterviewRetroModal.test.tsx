import { screen, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InterviewRetroModal } from './InterviewRetroModal';

describe('InterviewRetroModal', () => {
  it('disables Save until a rating is picked, then reports the full form state', async () => {
    const onSave = vi.fn();
    const onSkip = vi.fn();
    render(<InterviewRetroModal interviewType="Phone" onSave={onSave} onSkip={onSkip} />);

    expect(screen.getByRole('heading', { name: 'How did it go?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save retro' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByRole('button', { name: 'Save retro' })).toBeEnabled();

    await userEvent.type(screen.getByLabelText('What went well'), 'Good rapport');
    await userEvent.type(screen.getByLabelText('What to improve'), 'System design depth');
    await userEvent.click(screen.getByRole('button', { name: 'Technical' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save retro' }));

    expect(onSave).toHaveBeenCalledWith({
      retroRating: 3,
      retroWentWell: 'Good rapport',
      retroToImprove: 'System design depth',
      retroCategories: ['Technical'],
    });
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('Skip reports without requiring a rating', async () => {
    const onSave = vi.fn();
    const onSkip = vi.fn();
    render(<InterviewRetroModal interviewType="Phone" onSave={onSave} onSkip={onSkip} />);

    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
