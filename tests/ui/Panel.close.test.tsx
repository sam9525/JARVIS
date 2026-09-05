// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import Panel, { FOLD_MS, PANEL_OUT_MS } from "../../src/renderer/ui/Panel";
import type { PanelState } from "../../src/shared/types";

// The sibling Panel suite mocks React away to walk the element tree, which
// cannot carry state across a click. The exit is a state change, so this one
// runs the real runtime.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const STATE: PanelState = {
  x: 100,
  y: 80,
  w: 320,
  h: 400,
  z: 20,
  collapsed: false,
};

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

const render = (over: Partial<React.ComponentProps<typeof Panel>> = {}) =>
  act(() => {
    root.render(
      <Panel
        id="terminal"
        title="SESSION"
        state={STATE}
        focused
        onChange={() => {}}
        onFocus={() => {}}
        {...over}
      >
        <div />
      </Panel>,
    );
  });

const panel = () =>
  container.querySelector('[data-testid="panel-terminal"]') as HTMLElement;

describe("Panel open and close", () => {
  it("enters on its own when it carries no boot stage", async () => {
    await render();
    expect(panel().className.split(/\s+/)).toContain("panel-in");
  });

  it("leaves the entrance to the boot sequence when one is given", async () => {
    await render({ enterClass: "boot-hold" });
    const cls = panel().className.split(/\s+/);
    expect(cls).toContain("boot-hold");
    expect(cls).not.toContain("panel-in");
  });

  it("plays the exit before the owner unmounts it", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render({ onClose });
    await act(() => {
      (
        container.querySelector(
          '[data-testid="panel-close-terminal"]',
        ) as HTMLElement
      ).click();
    });
    // still on screen, now leaving
    expect(panel().className.split(/\s+/)).toContain("panel-out");
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PANEL_OUT_MS - 1);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // The settings panel's owner keeps the instance mounted and drives it with
  // `open`, so `closing` latching true after one ✕ left `leaving` up for good:
  // the panel never came back, and the effect re-fired onClose every time the
  // owner tried to reopen it. This harness is that owner.
  it("reopens after a ✕, for an owner that keeps the instance mounted", async () => {
    vi.useFakeTimers();
    const closed = vi.fn();
    let show!: (v: boolean) => void;
    function Owner() {
      const [open, setOpen] = React.useState(true);
      show = setOpen;
      return (
        <Panel
          id="terminal"
          title="SESSION"
          open={open}
          state={STATE}
          focused
          onChange={() => {}}
          onFocus={() => {}}
          onClose={() => {
            closed();
            setOpen(false); // exactly what App does with showSettings
          }}
        >
          <div />
        </Panel>
      );
    }
    act(() => root.render(<Owner />));

    act(() => {
      (
        container.querySelector(
          '[data-testid="panel-close-terminal"]',
        ) as HTMLElement
      ).click();
    });
    expect(panel().className.split(/\s+/)).toContain("panel-out");
    act(() => {
      vi.advanceTimersByTime(PANEL_OUT_MS);
    });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();

    // the ⚙ again
    act(() => show(true));
    expect(panel()).not.toBeNull();
    expect(panel().className.split(/\s+/)).toContain("panel-in");

    // and no stray exit fires afterwards
    act(() => {
      vi.advanceTimersByTime(PANEL_OUT_MS * 3);
    });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(panel()).not.toBeNull();
    vi.useRealTimers();
  });

  // guards the ref: `onClose` is an inline arrow in App, so as an effect dep it
  // would clear and re-arm the exit timer on every owner render — and App
  // re-renders per hook event, faster than PANEL_OUT_MS, so it would never fire
  it("finishes the exit through re-renders while it is running", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render({ onClose });
    await act(() => {
      (
        container.querySelector(
          '[data-testid="panel-close-terminal"]',
        ) as HTMLElement
      ).click();
    });
    for (let elapsed = 0; elapsed < PANEL_OUT_MS; elapsed += 20) {
      act(() => {
        vi.advanceTimersByTime(20);
      });
      await render({ onClose: () => onClose() }); // a new identity each time
    }
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("closes when the owner drops `open`, without touching onClose", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render({ open: true, onClose });
    await render({ open: false, onClose });
    expect(panel().className.split(/\s+/)).toContain("panel-out");
    act(() => {
      vi.advanceTimersByTime(PANEL_OUT_MS);
    });
    expect(panel()).toBeNull();
    // the ⚙ already knows it closed this — calling back would fight it
    expect(onClose).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("plays the exit for clear-the-deck too, then drops the node", async () => {
    vi.useFakeTimers();
    await render({ hidden: true });
    expect(panel().className.split(/\s+/)).toContain("panel-out");
    act(() => {
      vi.advanceTimersByTime(PANEL_OUT_MS);
    });
    expect(panel()).toBeNull();
    vi.useRealTimers();
  });

  it("restarts the fold timer when a second fold starts inside the first", async () => {
    vi.useFakeTimers();
    await render();
    await render({ state: { ...STATE, collapsed: true } });
    act(() => {
      vi.advanceTimersByTime(FOLD_MS - 40);
    });
    await render({ state: { ...STATE, collapsed: false } }); // ▸ mid-fold
    act(() => {
      vi.advanceTimersByTime(40);
    });
    // the first fold's timer must not strip the class out of the second one
    expect(panel().className.split(/\s+/)).toContain("panel-fold");
    act(() => {
      vi.advanceTimersByTime(FOLD_MS);
    });
    expect(panel().className.split(/\s+/)).not.toContain("panel-fold");
    vi.useRealTimers();
  });

  it("arms the fold transition only while a fold is in flight", async () => {
    vi.useFakeTimers();
    await render();
    expect(panel().className.split(/\s+/)).not.toContain("panel-fold");

    await render({ state: { ...STATE, collapsed: true } });
    expect(panel().className.split(/\s+/)).toContain("panel-fold");

    act(() => {
      vi.advanceTimersByTime(FOLD_MS);
    });
    // a drag or resize after the fold must not lag the pointer
    expect(panel().className.split(/\s+/)).not.toContain("panel-fold");
    vi.useRealTimers();
  });
});
