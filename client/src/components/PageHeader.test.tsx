import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/render";
import PageHeader from "./PageHeader";

// useDemoMode needs a QueryClient; the config query fails fast in tests
// (api unmocked), which resolves to demoMode=false.
vi.mock("../lib/api", () => ({
  api: vi.fn(),
}));

describe("PageHeader", () => {
  it('renders the heading "Job Discovery"', () => {
    renderWithRouter(<PageHeader onNewCriteria={() => {}} />);
    expect(
      screen.getByRole("heading", { name: "Job Discovery" }),
    ).toBeInTheDocument();
  });

  it("renders the description text", () => {
    renderWithRouter(<PageHeader onNewCriteria={() => {}} />);
    expect(
      screen.getByText(
        /Collects jobs from LinkedIn and Indeed into your pool/,
      ),
    ).toBeInTheDocument();
  });

  it("calls onNewCriteria when button is clicked", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    renderWithRouter(<PageHeader onNewCriteria={handleClick} />);

    await user.click(screen.getByRole("button", { name: /New Criteria/i }));
    expect(handleClick).toHaveBeenCalledOnce();
  });
});
