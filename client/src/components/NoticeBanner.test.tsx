import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/render";
import { api } from "../lib/api";
import { NoticeBanner } from "./NoticeBanner";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: vi.fn() };
});

function mockNotices(notices: unknown[]) {
  vi.mocked(api).mockImplementation((path: string, options?: { method?: string }) => {
    if (path === "/notices" && !options?.method) return Promise.resolve(notices);
    if (path.startsWith("/notices/") && options?.method === "DELETE") return Promise.resolve(null);
    return Promise.reject(new Error(`Unmocked api() call: ${path}`));
  });
}

const parkedProfile = {
  id: "n1",
  kind: "singleton_parked",
  data: { parked: "profile", retiredUserId: "22222222-2222-2222-2222-222222222222" },
  createdAt: "2026-09-14T10:00:00Z",
};

describe("NoticeBanner", () => {
  it("renders nothing when there are no notices", async () => {
    mockNotices([]);
    const { container } = renderWithRouter(<NoticeBanner />);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/notices"));
    expect(container.querySelector("[data-notice-banner]")).not.toBeInTheDocument();
  });

  // The requirement this component exists for: the merge happens during a
  // sign-in redirect, so there is no page alive to receive a toast. If the
  // parked document is only findable by someone who already knows it exists,
  // this is silent loss with extra steps.
  it("shows a parked document without the user having to go looking", async () => {
    mockNotices([parkedProfile]);
    renderWithRouter(<NoticeBanner />);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/kept your account's profile/i);
    expect(status).toHaveTextContent(/hasn't been deleted/i);
  });

  it("names the résumé rather than the collection", async () => {
    mockNotices([{ ...parkedProfile, data: { ...parkedProfile.data, parked: "resumeFile" } }]);
    renderWithRouter(<NoticeBanner />);

    expect(await screen.findByRole("status")).toHaveTextContent(/kept your account's résumé/i);
  });

  it("lists several parked documents readably", async () => {
    mockNotices([{ ...parkedProfile, data: { ...parkedProfile.data, parked: "profile,resumeFile" } }]);
    renderWithRouter(<NoticeBanner />);

    expect(await screen.findByRole("status")).toHaveTextContent(/profile and résumé/i);
  });

  it("dismisses server-side, not just locally", async () => {
    // Dismissal has to persist: a notice the user has read should not come
    // back on their next device, which rules out localStorage.
    mockNotices([parkedProfile]);
    const user = userEvent.setup();
    renderWithRouter(<NoticeBanner />);

    await user.click(await screen.findByRole("button", { name: /dismiss/i }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/notices/n1", { method: "DELETE" }),
    );
  });

  it("ignores a notice kind it does not know", async () => {
    // Forward compatibility: an older client must not crash on a newer kind.
    mockNotices([{ ...parkedProfile, kind: "something_new" }]);
    renderWithRouter(<NoticeBanner />);

    await waitFor(() => expect(api).toHaveBeenCalledWith("/notices"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
