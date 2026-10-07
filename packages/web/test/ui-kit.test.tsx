// Student UI kit: the visual building blocks the student screens guide with (progress,
// checklists, steppers, tab bar, celebration, skeleton and empty states).
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import {
  CheckRow, Celebrate, EmptyState, Progress, ProgressRing, Skeleton, Stepper, TabBar,
} from "../src/ui.js";

const at = (path: string, ui: ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe("Progress", () => {
  it("exposes value and max to assistive tech", () => {
    render(<Progress value={3} max={5} label="Challenges entered" />);
    const bar = screen.getByRole("progressbar", { name: "Challenges entered" });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
  });

  it("clamps out-of-range values and survives max 0", () => {
    const { rerender } = render(<Progress value={9} max={5} label="p" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "5");
    rerender(<Progress value={0} max={0} label="p" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("ProgressRing", () => {
  it("shows the count while in progress", () => {
    render(<ProgressRing value={2} max={3} label="Duels" />);
    expect(screen.getByRole("progressbar", { name: "Duels" })).toHaveTextContent("2/3");
  });

  it("turns into a check mark when complete", () => {
    render(<ProgressRing value={3} max={3} label="Duels" />);
    const ring = screen.getByRole("progressbar", { name: "Duels" });
    expect(ring).toHaveTextContent("✓");
    expect(ring).not.toHaveTextContent("3/3");
  });
});

describe("CheckRow", () => {
  it.each([
    ["todo", "To do"],
    ["doing", "In progress"],
    ["done", "Done"],
  ] as const)("labels the %s state", (state, label) => {
    render(<CheckRow state={state} title="Team pyramid" />);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it("is a link when given a destination", () => {
    at("/", <CheckRow state="todo" title="Team pyramid" meta="0 photos" to="/c/abc" />);
    const link = screen.getByRole("link", { name: /Team pyramid/ });
    expect(link).toHaveAttribute("href", "/c/abc");
    expect(link).toHaveTextContent("0 photos");
  });
});

describe("Stepper", () => {
  it("marks the current step for assistive tech", () => {
    render(
      <Stepper steps={[
        { label: "Join a team", state: "done" },
        { label: "Wait for the start", state: "current" },
        { label: "Snap the challenges", state: "upcoming" },
      ]} />,
    );
    const list = screen.getByRole("list", { name: "Next steps" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
  });
});

describe("TabBar", () => {
  const tabs = [
    { to: "/", label: "Home", icon: "🏠" },
    { to: "/challenges", label: "Challenges", icon: "📸", badge: 2 },
    { to: "/vote", label: "Vote", icon: "⚖️", disabled: true },
  ];

  it("marks the active tab, including nested paths", () => {
    at("/challenges/x", <TabBar tabs={tabs} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: /Challenges/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /Home/ })).not.toHaveAttribute("aria-current");
  });

  it("matches Home only exactly", () => {
    at("/", <TabBar tabs={tabs} />);
    expect(screen.getByRole("link", { name: /Home/ })).toHaveAttribute("aria-current", "page");
  });

  it("announces the to-do badge", () => {
    at("/", <TabBar tabs={tabs} />);
    expect(screen.getByRole("link", { name: /Challenges/ })).toHaveAccessibleName("Challenges, 2 to do");
  });

  it("renders a disabled tab as non-navigable", () => {
    at("/", <TabBar tabs={tabs} />);
    expect(screen.queryByRole("link", { name: /Vote/ })).not.toBeInTheDocument();
    expect(screen.getByText("Vote").closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Celebrate / EmptyState / Skeleton", () => {
  it("Celebrate announces itself", () => {
    render(<Celebrate icon="🎉" title="All voted!">Nice one.</Celebrate>);
    expect(screen.getByRole("status")).toHaveTextContent("All voted!");
  });

  it("EmptyState shows the icon, title and an action", () => {
    render(<EmptyState icon="🧭" title="No team yet"><button>Join</button></EmptyState>);
    expect(screen.getByText("No team yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("Skeleton is a busy loading placeholder with the requested lines", () => {
    const { container } = render(<Skeleton lines={4} />);
    const s = screen.getByRole("status", { name: "Loading" });
    expect(s).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll(".sk-line")).toHaveLength(4);
  });
});
