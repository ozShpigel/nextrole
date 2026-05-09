import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/render";
import TrackerPage from "./TrackerPage";

vi.mock("../components/Dashboard", () => ({
  default: () => <div data-testid="dashboard">Dashboard</div>,
}));
vi.mock("../components/ApplicationList", () => ({
  default: () => <div data-testid="application-list">Applications</div>,
}));
vi.mock("../components/AddApplication", () => ({
  default: ({ onSaved }: { onSaved: () => void }) => (
    <div data-testid="add-application">Add</div>
  ),
}));
vi.mock("../components/Statistics", () => ({
  default: () => <div data-testid="statistics">Statistics</div>,
}));

describe("TrackerPage", () => {
  it("renders page title and subtitle", () => {
    renderWithRouter(<TrackerPage />);
    expect(screen.getByText("Application Tracker")).toBeInTheDocument();
    expect(
      screen.getByText("Manage and track your hiring processes"),
    ).toBeInTheDocument();
  });

  it("renders all four tab buttons", () => {
    renderWithRouter(<TrackerPage />);
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Applications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Application" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Statistics" })).toBeInTheDocument();
  });

  it("shows Dashboard tab content by default", () => {
    renderWithRouter(<TrackerPage />);
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
  });

  it("clicking Applications tab shows application list", async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrackerPage />);

    await user.click(screen.getByRole("button", { name: "Applications" }));
    expect(screen.getByTestId("application-list")).toBeInTheDocument();
  });

  it("clicking Statistics tab shows statistics content", async () => {
    const user = userEvent.setup();
    renderWithRouter(<TrackerPage />);

    await user.click(screen.getByRole("button", { name: "Statistics" }));
    expect(screen.getByTestId("statistics")).toBeInTheDocument();
  });
});
