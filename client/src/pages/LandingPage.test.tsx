import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/render";
import Landing from "./LandingPage";

describe("LandingPage", () => {
  it("renders the page title", () => {
    renderWithRouter(<Landing />);
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("Role")).toBeInTheDocument();
  });

  it("renders the résumé upload CTA and the matches link", () => {
    renderWithRouter(<Landing />);
    expect(screen.getByRole("button", { name: /upload your résumé/i })).toBeInTheDocument();

    const matchesLink = screen.getByRole("link", { name: /browse your matches/i });
    expect(matchesLink).toHaveAttribute("href", "/search");
  });

  it("navigates to Settings with the upload param when the CTA is clicked", async () => {
    const user = userEvent.setup();
    renderWithRouter(<Landing />);

    await user.click(screen.getByRole("button", { name: /upload your résumé/i }));

    expect(window.location.pathname).toBe("/settings");
    expect(window.location.search).toBe("?upload=1");
  });

  it("renders the footer line with a GitHub link", () => {
    const { container } = renderWithRouter(<Landing />);
    expect(container.querySelector("footer")).toBeInTheDocument();
    const githubLink = screen.getByRole("link", { name: "GitHub" });
    expect(githubLink).toHaveAttribute("href", "https://github.com/ozShpigel/nextrole");
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});
