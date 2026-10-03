import { render, screen } from '@testing-library/react';
import AnalysisCard from './AnalysisCard';

const baseAnalysis = {
  overallScore: 75,
  verdict: 'YES',
};

describe('AnalysisCard - stored analyses from the LinkedIn era', () => {
  it('ignores the removed news and review signal fields', () => {
    // Analyses saved while jobs came from LinkedIn still carry these fields.
    // No live source supplies news or reviews any more (removed 2026-10-03),
    // so they are not rendered -- and the card must still render around them.
    render(
      <AnalysisCard
        matchAnalysisJson={JSON.stringify({
          ...baseAnalysis,
          companyNewsAnalysis: { greenSignals: ['גיוס הון חדש'], redSignals: [], summary: 'news summary' },
          employeeReviewsAnalysis: {
            greenSignals: ['עובדים מרוצים מהאיזון בין עבודה לחיים'],
            redSignals: ['ציון נמוך להזדמנויות קידום'],
            summary: 'reviews summary',
          },
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'AI Analysis' })).toBeInTheDocument();
    expect(screen.queryByText('Company News Signals')).not.toBeInTheDocument();
    expect(screen.queryByText('Employee Review Signals')).not.toBeInTheDocument();
    expect(screen.queryByText('גיוס הון חדש')).not.toBeInTheDocument();
    expect(screen.queryByText('reviews summary')).not.toBeInTheDocument();
  });
});
