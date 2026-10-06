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

describe('AnalysisCard - a dimension the server did not assess', () => {
  // Sustainability is dropped from the total when the posting says nothing
  // about pace; the server sends its score as null and renormalises the rest.
  const renormalised = {
    overallScore: 43,
    verdict: 'NO',
    breakdown: {
      technicalFit: { score: 18, maxScore: 35, components: [] },
      engineeringExecutionFit: { score: 10, maxScore: 30, components: [] },
      sustainabilityPaceFit: { score: null, maxScore: 35, components: [] },
    },
  };

  it('says "Not assessed" instead of a dash out of 35', () => {
    render(<AnalysisCard matchAnalysisJson={JSON.stringify(renormalised)} />);
    expect(screen.getByText('Not assessed')).toBeInTheDocument();
    // The old rendering was an em dash where the score would be.
    expect(screen.queryByText('—', { exact: false })).not.toBeInTheDocument();
  });

  it('says what the total was computed from', () => {
    render(<AnalysisCard matchAnalysisJson={JSON.stringify(renormalised)} />);
    expect(screen.getByText('Scored on Technical + Execution (28/65)')).toBeInTheDocument();
  });

  it('adds no such line when every dimension was assessed', () => {
    const full = {
      ...renormalised,
      breakdown: { ...renormalised.breakdown, sustainabilityPaceFit: { score: 20, maxScore: 35, components: [] } },
    };
    render(<AnalysisCard matchAnalysisJson={JSON.stringify(full)} />);
    expect(screen.queryByText(/Scored on/)).not.toBeInTheDocument();
    expect(screen.queryByText('Not assessed')).not.toBeInTheDocument();
  });
});
