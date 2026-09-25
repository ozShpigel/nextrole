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
    mockRoutes({ "/config": {} });
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
      "/config": {},
      "/auth/me": { signedIn: false, email: null, available: false },
    });
    mockProfile(false);
    renderWithRouter(<Landing />);
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

  it("selecting a résumé shows the read here, in place, while it runs", async () => {
    // The first part of the wait is about the CV, not jobs, so it happens on
    // Landing — never behind a small button spinner, and never as a grid of
    // job skeletons promising what cannot exist yet.
    vi.mocked(matchApi).mockImplementation(() => new Promise(() => {}));
    renderWithRouter(<Landing />);

    const file = new File(["resume bytes"], "resume-reading.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByTestId("resume-file-input") as HTMLInputElement, file);

    expect(await screen.findByText("Reading your résumé…")).toBeInTheDocument();
    expect(screen.getByTestId("upload-progress")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upload your résumé/i })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("shows what was found, then moves to Matches", async () => {
    // The short read lands first: its real result is shown back, then the
    // board takes over while the full read is still running.
    vi.mocked(matchApi).mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/profile/normalize-file?scope=essentials") return Promise.resolve({
        summary: "Infra engineer.", seniority: "Senior",
        experience: [{ title: "Platform Developer", company: "Payoneer", dates: "2023", highlights: [] }],
        skills: [{ category: "Platform", items: ["Kubernetes", "Terraform"] }],
      });
      if (path === "/profile/normalize-file") return new Promise(() => {});
      if (path === "/profile" && options?.method === "PUT") return Promise.resolve({});
      if (path === "/profile") return Promise.resolve({ content: "", structured: {} });
      if (path === "/profile/resume-file") return Promise.reject(Object.assign(new Error("not found"), { status: 404 }));
      return Promise.reject(new Error(`Unmocked matchApi() call: ${path}`));
    });
    renderWithRouter(<Landing />);

    const file = new File(["resume bytes"], "resume-matching.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByTestId("resume-file-input") as HTMLInputElement, file);

    expect(await screen.findByText("Platform Developer · Senior")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    await waitFor(() => expect(window.location.pathname).toBe("/search"), { timeout: 3000 });
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
