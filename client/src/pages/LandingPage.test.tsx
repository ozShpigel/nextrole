import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/render";
import { api } from "../lib/api";
import Landing from "./LandingPage";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: vi.fn() };
});

function mockRoutes(routes: Record<string, unknown>) {
  vi.mocked(api).mockImplementation((path: string) =>
    path in routes ? Promise.resolve(routes[path]) : Promise.reject(new Error(`Unmocked api() call: ${path}`)),
  );
}

describe("LandingPage", () => {
  beforeEach(() => {
    // Tests navigate via the real BrowserRouter (shared jsdom window) —
    // reset the URL so a prior test's navigation doesn't leak into this one.
    window.history.pushState({}, "", "/");
    mockRoutes({ "/config": { demoMode: false } });
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

  it("in demo mode, clicking the CTA shows a fake file dialog instead of the real picker", async () => {
    // Real upload is 403'd server-side in DemoMode anyway (it persists a
    // file) — the demo shows a fake OS file-open dialog with the persona's
    // résumé instead of the real picker.
    mockRoutes({ "/config": { demoMode: true } });
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    renderWithRouter(<Landing />);

    await waitFor(() => expect(api).toHaveBeenCalledWith("/config"));
    await user.click(screen.getByRole("button", { name: /upload your résumé/i }));

    expect(clickSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Alex_Morgan_Resume.pdf")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    clickSpy.mockRestore();
  });

  it("in demo mode, selecting the fake résumé in the fake dialog goes to the fake processing animation", async () => {
    mockRoutes({ "/config": { demoMode: true } });
    const user = userEvent.setup();
    renderWithRouter(<Landing />);

    await waitFor(() => expect(api).toHaveBeenCalledWith("/config"));
    await user.click(screen.getByRole("button", { name: /upload your résumé/i }));
    await user.dblClick(screen.getByText("Alex_Morgan_Resume.pdf"));

    expect(window.location.pathname).toBe("/processing");
  });

  it("in demo mode, canceling the fake dialog stays on the landing page", async () => {
    mockRoutes({ "/config": { demoMode: true } });
    const user = userEvent.setup();
    renderWithRouter(<Landing />);

    await waitFor(() => expect(api).toHaveBeenCalledWith("/config"));
    await user.click(screen.getByRole("button", { name: /upload your résumé/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText("Alex_Morgan_Resume.pdf")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
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
