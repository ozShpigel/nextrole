import { screen } from "@testing-library/react";
import { renderWithRouter } from "../test/render";
import Landing from "./LandingPage";

describe("LandingPage", () => {
  it("renders the page title", () => {
    renderWithRouter(<Landing />);
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("Role")).toBeInTheDocument();
  });

  it("renders all three service cards with correct names", () => {
    renderWithRouter(<Landing />);
    expect(screen.getByText("Job Discovery")).toBeInTheDocument();
    expect(screen.getByText("Application Tracker")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("each service card links to the correct path", () => {
    renderWithRouter(<Landing />);

    const discoveryLink = screen.getByRole("link", { name: /job discovery/i });
    expect(discoveryLink).toHaveAttribute("href", "/discovery");

    const trackerLink = screen.getByRole("link", { name: /application tracker/i });
    expect(trackerLink).toHaveAttribute("href", "/tracker");

    const settingsLink = screen.getByRole("link", { name: /settings/i });
    expect(settingsLink).toHaveAttribute("href", "/settings");
  });

  it("renders the version badge", () => {
    renderWithRouter(<Landing />);
    expect(screen.getByText(/V 0\.1\.0/)).toBeInTheDocument();
  });

  it("renders the footer", () => {
    renderWithRouter(<Landing />);
    expect(screen.getByText(/NextRole/)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
});
