import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/render';
import NotFoundPage from './NotFoundPage';

describe('NotFoundPage', () => {
  it('renders 404 heading and message', () => {
    renderWithRouter(<NotFoundPage />);

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('has a link back to home', () => {
    renderWithRouter(<NotFoundPage />);

    const link = screen.getByRole('link', { name: 'Back to Home' });
    expect(link).toHaveAttribute('href', '/');
  });
});
