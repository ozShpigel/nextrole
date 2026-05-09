import { render, screen } from "@testing-library/react";
import ScoreBar from "./ScoreBar";

describe("ScoreBar", () => {
  it("renders label text", () => {
    render(<ScoreBar label="Experience" score={80} maxScore={100} />);
    expect(screen.getByText("Experience")).toBeInTheDocument();
  });

  it("shows score/maxScore (e.g. 80/100)", () => {
    render(<ScoreBar label="Experience" score={80} maxScore={100} />);
    expect(screen.getByText("80/100")).toBeInTheDocument();
  });

  it('shows "N/A/?" when score and maxScore are null', () => {
    render(<ScoreBar label="Experience" score={null} maxScore={null} />);
    expect(screen.getByText("N/A/?")).toBeInTheDocument();
  });
});
