import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/render";
import { api, matchApi } from "../lib/api";
import Landing from "./LandingPage";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: vi.fn(), matchApi: vi.fn() };
});

// Whether this visitor has uploaded a CV, as useHasProfile reads it: the
// profile's rendered content, or a stored résumé file.
function mockProfile(hasProfile: boolean) {
  vi.mocked(matchApi).mockImplementation((path: string) => {
    if (path === "/profile") {
      return Promise.resolve(hasProfile ? { content: "<professional_profile>…", structured: {} } : { content: "", structured: {} });
    }
    if (path === "/profile/resume-file") {
      return hasProfile
        ? Promise.resolve({ fileName: "cv.pdf" })
        : Promise.reject(Object.assign(new Error("not found"), { status: 404 }));
    }
    return Promise.reject(new Error(`Unmocked matchApi() call: ${path}`));
  });
}

function mockRoutes(routes: Record<string, unknown>) {
  // /auth/me defaults to "sign-in is available" so the existing cases exercise
  // the real gating; the tests that care override it.
  const withDefaults: Record<string, unknown> = { '/auth/me': { signedIn: false, email: null, available: true }, ...routes };
  vi.mocked(api).mockImplementation((path: string) =>
    path in withDefaults ? Promise.resolve(withDefaults[path]) : Promise.reject(new Error(`Unmocked api() call: ${path}`)),
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

  it("renders the résumé upload CTA", () => {
    mockProfile(false);
    renderWithRouter(<Landing />);
    expect(screen.getByRole("button", { name: /upload your résumé/i })).toBeInTheDocument();
  });

  // "Browse your matches" is a promise nobody without a CV can be shown —
  // Matches has nothing to list until a profile exists to score against, and
  // the onboarding gate bounces them back here anyway.
  it("hides the matches link until a CV has been uploaded", async () => {
    mockProfile(false);
    renderWithRouter(<Landing />);
    await waitFor(() => expect(vi.mocked(matchApi)).toHaveBeenCalledWith("/profile"));
    expect(screen.queryByRole("link", { name: /browse your matches/i })).not.toBeInTheDocument();
  });

  it("shows the matches link once a profile exists", async () => {
    mockProfile(true);
    renderWithRouter(<Landing />);
    const matchesLink = await screen.findByRole("link", { name: /browse your matches/i });
    expect(matchesLink).toHaveAttribute("href", "/search");
  });

  // Sign-in is offered, never required: the uid cookie is still the only
  // identity and uploading a CV is the whole onboarding. The link exists so a
  // visitor whose cookie is gone (cleared, or a different device) has a way
  // back to their account at all.
  it("offers Google sign-in to a visitor with no profile", async () => {
    mockProfile(false);
    renderWithRouter(<Landing />);
    const link = await screen.findByRole("link", { name: /sign in with google/i });
    expect(link).toHaveAttribute("href", "/api/auth/google/start");
  });

  // Already onboarded in this browser — we know who they are, so the row shows
  // "Browse your matches" instead. Linking a Google account to an existing
  // session belongs in Settings, not here.
  it("hides Google sign-in once a profile exists", async () => {
    mockProfile(true);
    renderWithRouter(<Landing />);
    await screen.findByRole("link", { name: /browse your matches/i });
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  // Fixed-mode (private) instances take identity from configuration and issue
  // no cookie, so there is nothing for a sign-in to change. The client cannot
  // tell that from the URL — the server says so via /auth/me.
  it("hides Google sign-in when the instance cannot do sign-in", async () => {
    mockRoutes({
      "/config": { demoMode: false },
      "/auth/me": { signedIn: false, email: null, available: false },
    });
    mockProfile(false);
    renderWithRouter(<Landing />);
    await waitFor(() => expect(vi.mocked(matchApi)).toHaveBeenCalledWith("/profile"));
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  it("hides Google sign-in in demo mode", async () => {
    mockRoutes({ "/config": { demoMode: true } });
    mockProfile(false);
    renderWithRouter(<Landing />);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/config"));
    await waitFor(() => expect(vi.mocked(matchApi)).toHaveBeenCalledWith("/profile"));
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
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
