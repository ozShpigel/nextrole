import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/render";
import Landing from "./LandingPage";

describe("LandingPage", () => {
  beforeEach(() => {
    // Tests navigate via the real BrowserRouter (shared jsdom window) —
    // reset the URL so a prior test's navigation doesn't leak into this one.
    window.history.pushState({}, "", "/");
  });

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

  it("clicking the CTA opens the file picker synchronously (no navigation first)", async () => {
    // Regression check: opening a file input must happen inside the same
    // click handler as the user gesture — routing through another page
    // first (as this used to do) loses the browser's "user activation" and
    // the native picker silently refuses to open.
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    renderWithRouter(<Landing />);

    await user.click(screen.getByRole("button", { name: /upload your résumé/i }));

    expect(clickSpy).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
    clickSpy.mockRestore();
  });

  it("selecting a résumé hands it off to the processing page immediately, without parsing it here", async () => {
    // The real parse/save happens on ProcessingPage, underneath its
    // animation — not here, and not before navigating (see ProcessingPage
    // for why: it's a slow real API call and must not happen behind a
    // small button spinner with the animation only flashing by at the end).
    renderWithRouter(<Landing />);

    const file = new File(["resume bytes"], "resume.pdf", { type: "application/pdf" });
    const input = screen.getByTestId("resume-file-input") as HTMLInputElement;
    await userEvent.upload(input, file);

    expect(window.location.pathname).toBe("/processing");
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
