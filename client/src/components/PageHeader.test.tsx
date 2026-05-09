import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PageHeader from "./PageHeader";

describe("PageHeader", () => {
  it('renders the heading "Job Discovery"', () => {
    render(<PageHeader onNewCriteria={() => {}} />);
    expect(
      screen.getByRole("heading", { name: "Job Discovery" }),
    ).toBeInTheDocument();
  });

  it("renders the description text", () => {
    render(<PageHeader onNewCriteria={() => {}} />);
    expect(
      screen.getByText(
        "Automated job search from LinkedIn and Indeed with AI-powered scoring and matching via Claude.",
      ),
    ).toBeInTheDocument();
  });

  it("calls onNewCriteria when button is clicked", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(<PageHeader onNewCriteria={handleClick} />);

    await user.click(screen.getByRole("button", { name: /New Criteria/i }));
    expect(handleClick).toHaveBeenCalledOnce();
  });
});
