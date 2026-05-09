import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./Status";

describe("StatusBadge", () => {
  it("renders the correct label for a known status", () => {
    render(<StatusBadge status="Applied" />);
    expect(screen.getByText("Applied")).toBeInTheDocument();
  });

  it("renders the mapped label for a multi-word status", () => {
    render(<StatusBadge status="DecidedToApply" />);
    expect(screen.getByText("Decided to Apply")).toBeInTheDocument();
  });

  it("falls back to raw status string for unknown status", () => {
    render(<StatusBadge status="CustomStatus" />);
    expect(screen.getByText("CustomStatus")).toBeInTheDocument();
  });

  it("renders without crashing for various valid statuses", () => {
    const statuses = [
      "Analyzing",
      "PhoneScreen",
      "TechnicalInterview",
      "FinalRound",
      "OfferReceived",
      "Accepted",
      "Rejected",
      "Withdrawn",
    ];

    for (const status of statuses) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(/./)).toBeInTheDocument();
      unmount();
    }
  });
});
