import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CollapsibleSection from "./CollapsibleSection";

describe("CollapsibleSection", () => {
  it("renders title and children when defaultOpen is true (default)", () => {
    render(
      <CollapsibleSection title="Details">
        <p>Section content</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Section content")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("hides children when defaultOpen is false", () => {
    render(
      <CollapsibleSection title="Details" defaultOpen={false}>
        <p>Hidden content</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles content visibility on click", async () => {
    const user = userEvent.setup();

    render(
      <CollapsibleSection title="Details">
        <p>Toggle me</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Toggle me")).toBeInTheDocument();

    await user.click(screen.getByRole("button"));
    expect(screen.queryByText("Toggle me")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Toggle me")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("supports keyboard activation (Enter key)", async () => {
    const user = userEvent.setup();

    render(
      <CollapsibleSection title="Details">
        <p>Keyboard toggle</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Keyboard toggle")).toBeInTheDocument();

    screen.getByRole("button").focus();
    await user.keyboard("{Enter}");

    expect(screen.queryByText("Keyboard toggle")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
  });
});
