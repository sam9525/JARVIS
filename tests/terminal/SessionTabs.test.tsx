// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import SessionTabs from "../../src/renderer/terminal/SessionTabs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Tab = React.ComponentProps<typeof SessionTabs>["tabs"][number];

const tab = (key: string, label: string, extra: Partial<Tab> = {}): Tab => ({
  key,
  label,
  kind: "idle",
  ...extra,
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props: Partial<React.ComponentProps<typeof SessionTabs>>) => {
  const all = {
    tabs: [tab("w", "main")],
    value: "w",
    onSelect: vi.fn(),
    ...props,
  };
  act(() => {
    root.render(<SessionTabs {...all} />);
  });
  return all;
};

const tabButtons = () =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-tab]"));
const newButton = () =>
  container.querySelector<HTMLElement>('[data-testid="session-new"]');
const closeControl = (key: string) =>
  container.querySelector<HTMLElement>(`[data-close="${key}"]`);

describe("SessionTabs", () => {
  it("renders the labels in order", () => {
    render({
      tabs: [tab("w", "main"), tab("w#1", "1"), tab("w#2", "2")],
    });
    expect(tabButtons().map((b) => b.dataset.label)).toEqual([
      "main",
      "1",
      "2",
    ]);
  });

  it("offers + below the cap and hides it at 4 tabs", () => {
    render({ tabs: [tab("w", "main")], onNew: vi.fn() });
    expect(newButton()).not.toBeNull();
    render({
      tabs: [
        tab("w", "main"),
        tab("w#1", "1"),
        tab("w#2", "2"),
        tab("w#3", "3"),
      ],
      onNew: vi.fn(),
    });
    expect(newButton()).toBeNull();
  });

  it("offers no + without onNew", () => {
    render({ tabs: [tab("w", "main")] });
    expect(newButton()).toBeNull();
  });

  it("calls onNew from +", () => {
    const { onNew } = render({ tabs: [tab("w", "main")], onNew: vi.fn() });
    act(() => newButton()?.click());
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("selects a tab by its key", () => {
    const { onSelect } = render({ tabs: [tab("w", "main"), tab("w#1", "1")] });
    act(() => tabButtons()[1].click());
    expect(onSelect).toHaveBeenCalledWith("w#1");
  });

  it("closes a non-main tab without selecting it, and offers no close on main", () => {
    const onClose = vi.fn();
    const { onSelect } = render({
      tabs: [tab("w", "main", { main: true }), tab("w#1", "1")],
      onClose,
    });
    expect(closeControl("w")).toBeNull();
    act(() => closeControl("w#1")?.click());
    expect(onClose).toHaveBeenCalledWith("w#1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers no close on the main agent tab either", () => {
    render({
      tabs: [tab("self", "MAIN AGENT", { main: true }), tab("s#1", "SCRATCH")],
      value: "self",
      onClose: vi.fn(),
    });
    expect(closeControl("self")).toBeNull();
    expect(closeControl("s#1")).not.toBeNull();
  });

  it("shows no tabs for a lone session, only its status dot", () => {
    render({ tabs: [tab("w", "main", { kind: "working" })], onNew: vi.fn() });
    expect(tabButtons()).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-testid="session-dot"]'),
    ).toHaveLength(1);
    expect(newButton()).not.toBeNull();
  });

  it("spells out the state with two tabs and drops it with three", () => {
    render({ tabs: [tab("w", "main", { kind: "working" }), tab("w#1", "1")] });
    expect(container.textContent).toContain("· working");
    render({
      tabs: [
        tab("w", "main", { kind: "working" }),
        tab("w#1", "1"),
        tab("w#2", "2"),
      ],
    });
    expect(container.textContent).not.toContain("· working");
  });

  it("marks a tab opened while selected as new until another is selected", () => {
    render({ tabs: [tab("w", "main")], value: "w" });
    render({ tabs: [tab("w", "main"), tab("w#1", "1")], value: "w#1" });
    expect(container.textContent).toContain("· new");
    render({ tabs: [tab("w", "main"), tab("w#1", "1")], value: "w" });
    render({ tabs: [tab("w", "main"), tab("w#1", "1")], value: "w#1" });
    expect(container.textContent).not.toContain("· new");
  });

  it("marks nothing new on the first render", () => {
    render({ tabs: [tab("w", "main"), tab("w#1", "1")], value: "w#1" });
    expect(container.textContent).not.toContain("· new");
  });

  it("colours an unselected asking tab warm", () => {
    render({
      tabs: [tab("w", "main"), tab("w#1", "1", { kind: "asking" })],
      value: "w",
    });
    expect(tabButtons()[1].className).toContain("text-warm");
    expect(tabButtons()[0].className).not.toContain("text-warm");
  });

  it("drops hints at the cap", () => {
    render({
      tabs: [
        tab("w", "main"),
        tab("w#1", "1", { hint: "worktree" }),
        tab("w#2", "2"),
        tab("w#3", "3"),
      ],
    });
    expect(container.textContent).not.toContain("worktree");
  });

  it("shows a status dot per tab and a tab's hint", () => {
    render({
      tabs: [
        tab("w", "main", { kind: "working" }),
        tab("w#1", "1", { hint: "shared folder" }),
      ],
    });
    expect(
      container.querySelectorAll('[data-testid="session-dot"]'),
    ).toHaveLength(2);
    expect(container.textContent).toContain("shared folder");
  });
});
