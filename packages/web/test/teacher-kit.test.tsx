// Teacher UI kit: safe confirmations, action feedback, section nav and stats — the building
// blocks the teacher desk screens are rebuilt with.
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { HttpError } from "../src/api.js";
import {
  Button, ConfirmProvider, CopyField, Notice, SectionNav, Stats, useAction, useConfirm,
  type ConfirmOptions,
} from "../src/ui.js";

const at = (path: string, ui: ReactNode) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

describe("Button", () => {
  it("has approve/reject tones", () => {
    render(<><Button variant="good">Approve</Button><Button variant="crit">Reject</Button></>);
    expect(screen.getByRole("button", { name: "Approve" })).toHaveClass("btn-good");
    expect(screen.getByRole("button", { name: "Reject" })).toHaveClass("btn-crit");
  });

  it("is disabled and announced as busy while busy", () => {
    render(<Button busy>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
  });
});

describe("Notice", () => {
  it("announces success politely and errors assertively", () => {
    render(<><Notice tone="ok">Saved.</Notice><Notice tone="err">Could not save.</Notice></>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save.");
  });

  it("renders nothing without a message", () => {
    const { container } = render(<Notice tone="err">{""}</Notice>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("useAction", () => {
  function Harness({ fn, fallback }: { fn: () => Promise<unknown>; fallback?: string }) {
    const a = useAction(fn, fallback);
    return (
      <>
        <Button busy={a.busy} onClick={a.run}>Go</Button>
        <Notice tone="err">{a.error}</Notice>
        {a.done && <span>done</span>}
      </>
    );
  }

  it("runs once while busy (no double submit) and reports done", async () => {
    let resolve!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const user = userEvent.setup();
    render(<Harness fn={fn} />);
    const go = screen.getByRole("button", { name: "Go" });
    await user.click(go);
    expect(go).toBeDisabled();
    await user.click(go);
    expect(fn).toHaveBeenCalledTimes(1);
    resolve();
    expect(await screen.findByText("done")).toBeInTheDocument();
    expect(go).toBeEnabled();
  });

  it("shows the API's reason when the call fails", async () => {
    const fn = () => Promise.reject(new HttpError(429, JSON.stringify({ error: "too_many_requests", message: "Too many requests." })));
    const user = userEvent.setup();
    render(<Harness fn={fn} />);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests.");
  });

  it("adds the reference when the server failed (#69)", async () => {
    const fn = () => Promise.reject(new HttpError(500, JSON.stringify({ error: "internal_error", message: "Something went wrong on our side.", requestId: "abc-123" })));
    const user = userEvent.setup();
    render(<Harness fn={fn} />);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on our side. Reference: abc-123");
  });

  it("falls back to a plain message for non-HTTP failures", async () => {
    const user = userEvent.setup();
    render(<Harness fn={() => Promise.reject(new Error("boom"))} fallback="Could not approve." />);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not approve.");
  });
});

describe("useConfirm", () => {
  function Asker({ opts, onResult }: { opts: ConfirmOptions; onResult: (ok: boolean) => void }) {
    const confirm = useConfirm();
    return <button onClick={async () => onResult(await confirm(opts))}>Ask</button>;
  }
  const ask = async (opts: ConfirmOptions) => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmProvider><Asker opts={opts} onResult={onResult} /></ConfirmProvider>);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    return { user, onResult, dialog: screen.getByRole("alertdialog", { name: opts.title }) };
  };

  it("resolves true on confirm", async () => {
    const { user, onResult, dialog } = await ask({ title: "Delete challenge?", confirmLabel: "Delete" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("resolves false on cancel and on Escape, focusing Cancel by default", async () => {
    const first = await ask({ title: "Delete challenge?", confirmLabel: "Delete" });
    expect(within(first.dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await first.user.keyboard("{Escape}");
    await waitFor(() => expect(first.onResult).toHaveBeenCalledWith(false));
  });

  it("requires typing the given text before a dangerous confirm", async () => {
    const { user, onResult, dialog } = await ask({
      title: "Erase all student data?", body: "This cannot be undone.", confirmLabel: "Erase", danger: true, typeToConfirm: "Rome 2030",
    });
    expect(dialog).toHaveTextContent("This cannot be undone.");
    const erase = within(dialog).getByRole("button", { name: "Erase" });
    expect(erase).toBeDisabled();
    const input = within(dialog).getByLabelText(/Type “Rome 2030” to confirm/);
    expect(input).toHaveFocus();
    await user.type(input, "Rome 203");
    expect(erase).toBeDisabled();
    await user.type(input, "0");
    await user.click(erase);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("resolves false when the backdrop is clicked", async () => {
    const { user, onResult, dialog } = await ask({ title: "Remove photo?" });
    await user.click(dialog.parentElement!);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});

describe("CopyField", () => {
  it("copies the value and confirms", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<CopyField label="Recovery link" value="https://x.test/join?trip=t1" />);
    expect(screen.getByLabelText("Recovery link")).toHaveValue("https://x.test/join?trip=t1");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("https://x.test/join?trip=t1");
    expect(await screen.findByRole("button", { name: "Copied ✓" })).toBeInTheDocument();
  });

  it("selects the text when the clipboard is unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<CopyField label="Recovery link" value="abc" />);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByLabelText("Recovery link")).toHaveFocus());
  });
});

describe("Stats", () => {
  it("lists label/value pairs and flags the ones needing attention", () => {
    at("/", <Stats items={[
      { label: "Students", value: 24 },
      { label: "To review", value: 3, flag: true, to: "/teacher/trips/t1/review" },
    ]} />);
    const review = screen.getByRole("link", { name: /To review/ });
    expect(review).toHaveAttribute("href", "/teacher/trips/t1/review");
    expect(review).toHaveTextContent("3");
    expect(review).toHaveClass("flag");
    expect(screen.getByText("Students").closest(".tile")).not.toHaveClass("flag");
  });
});

describe("SectionNav", () => {
  const items = [
    { to: "/teacher/trips/t1", label: "Overview", end: true },
    { to: "/teacher/trips/t1/review", label: "Review", badge: 3 },
    { to: "/teacher/trips/t1/settings", label: "Settings" },
  ];

  it("marks the current section; Overview only matches exactly", () => {
    at("/teacher/trips/t1/review", <SectionNav label="Trip" items={items} />);
    const nav = screen.getByRole("navigation", { name: "Trip" });
    expect(within(nav).getByRole("link", { name: /Review/ })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("announces the badge count", () => {
    at("/teacher/trips/t1", <SectionNav label="Trip" items={items} />);
    expect(screen.getByRole("link", { name: "Review, 3 pending" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });
});
