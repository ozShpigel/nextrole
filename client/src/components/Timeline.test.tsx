import { render, screen } from "@testing-library/react";
import Timeline from "./Timeline";

vi.mock("./Status", () => ({
  StatusBadge: ({ status }: any) => (
    <span data-testid="status-badge">{status}</span>
  ),
}));

describe("Timeline", () => {
  it('shows "No activity yet" when no items provided', () => {
    render(<Timeline statusUpdates={[]} interviews={[]} notes={[]} />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("renders status updates with badges", () => {
    render(
      <Timeline
        statusUpdates={[
          {
            timestamp: "2026-05-01T10:00:00Z",
            fromStatus: "Applied",
            toStatus: "PhoneScreen",
          },
        ]}
        interviews={[]}
        notes={[]}
      />,
    );

    const badges = screen.getAllByTestId("status-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("Applied");
    expect(badges[1]).toHaveTextContent("PhoneScreen");
  });

  it("renders interviews with type", () => {
    render(
      <Timeline
        statusUpdates={[]}
        interviews={[
          {
            id: "i1",
            type: "Technical",
            scheduledAt: "2026-05-02T14:00:00Z",
            completed: false,
          },
        ]}
        notes={[]}
      />,
    );

    expect(screen.getByText(/Interview: Technical/)).toBeInTheDocument();
  });

  it("renders notes with truncated content", () => {
    const longContent =
      "This is a very long note that exceeds one hundred characters in length so that the component will truncate it with an ellipsis at the end.";
    render(
      <Timeline
        statusUpdates={[]}
        interviews={[]}
        notes={[
          { id: "n1", content: longContent, createdAt: "2026-05-03T09:00:00Z" },
        ]}
      />,
    );

    expect(
      screen.getByText(longContent.substring(0, 100) + "..."),
    ).toBeInTheDocument();
  });

  it("sorts items by date descending (newest first)", () => {
    render(
      <Timeline
        statusUpdates={[
          {
            timestamp: "2026-05-01T10:00:00Z",
            fromStatus: "Applied",
            toStatus: "PhoneScreen",
          },
        ]}
        interviews={[
          {
            id: "i1",
            type: "Technical",
            scheduledAt: "2026-05-03T14:00:00Z",
            completed: false,
          },
        ]}
        notes={[
          {
            id: "n1",
            content: "Middle note",
            createdAt: "2026-05-02T09:00:00Z",
          },
        ]}
      />,
    );

    const allItems = screen.getAllByText(
      /Interview: Technical|Middle note|Applied/,
    );
    // Newest first: interview (May 3), note (May 2), status badge text (May 1)
    expect(allItems[0]).toHaveTextContent("Interview: Technical");
    expect(allItems[1]).toHaveTextContent("Middle note");
  });
});
