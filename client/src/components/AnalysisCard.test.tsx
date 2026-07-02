import { render, screen } from '@testing-library/react';
import AnalysisCard from './AnalysisCard';

const baseAnalysis = {
  overallScore: 75,
  verdict: 'YES',
};

describe('AnalysisCard - enrichment signal blocks', () => {
  it('renders employee review signals and summary', () => {
    render(
      <AnalysisCard
        matchAnalysisJson={JSON.stringify({
          ...baseAnalysis,
          employeeReviewsAnalysis: {
            greenSignals: ['עובדים מרוצים מהאיזון בין עבודה לחיים'],
            redSignals: ['ציון נמוך להזדמנויות קידום'],
            summary: 'הביקורות מעידות על סביבת עבודה מאוזנת.',
          },
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'AI Analysis' })).toBeInTheDocument();
    expect(screen.getByText('Employee Review Signals')).toBeInTheDocument();
    expect(screen.getByText('עובדים מרוצים מהאיזון בין עבודה לחיים')).toBeInTheDocument();
    expect(screen.getByText('ציון נמוך להזדמנויות קידום')).toBeInTheDocument();
    expect(screen.getByText('הביקורות מעידות על סביבת עבודה מאוזנת.')).toBeInTheDocument();
  });

  it('renders company news signals alongside employee review signals', () => {
    render(
      <AnalysisCard
        matchAnalysisJson={JSON.stringify({
          ...baseAnalysis,
          companyNewsAnalysis: { greenSignals: ['גיוס הון חדש'], redSignals: [], summary: '' },
          employeeReviewsAnalysis: { greenSignals: ['שביעות רצון גבוהה'], redSignals: [], summary: '' },
        })}
      />,
    );
    expect(screen.getByText('Company News Signals')).toBeInTheDocument();
    expect(screen.getByText('Employee Review Signals')).toBeInTheDocument();
  });

  it('omits the employee review block when analysis has no signals', () => {
    render(
      <AnalysisCard
        matchAnalysisJson={JSON.stringify({
          ...baseAnalysis,
          employeeReviewsAnalysis: { greenSignals: [], redSignals: [], summary: '' },
        })}
      />,
    );
    expect(screen.queryByText('Employee Review Signals')).not.toBeInTheDocument();
  });

  it('omits the block entirely when the field is absent', () => {
    render(<AnalysisCard matchAnalysisJson={JSON.stringify(baseAnalysis)} />);
    expect(screen.queryByText('Employee Review Signals')).not.toBeInTheDocument();
    expect(screen.queryByText('Company News Signals')).not.toBeInTheDocument();
  });
});
