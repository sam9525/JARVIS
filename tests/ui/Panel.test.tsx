// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = (await vi.importActual("react")) as any;
  return {
    ...actual,
    useRef: (init: any) => ({ current: init }),
    useCallback: (fn: any) => fn,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useState: (init: any) => [
      typeof init === "function" ? init() : init,
      () => {},
    ],
  };
});

import Panel from "../../src/renderer/ui/Panel";
import { LBL_CY } from "../../src/renderer/ui/hud";
import { TITLE_BAR_H } from "../../src/renderer/ui/panel-layout";
import type { PanelState } from "../../src/shared/types";

// depth-first, source order
const walk = (n: any): any[] =>
  !n || typeof n !== "object"
    ? []
    : Array.isArray(n)
      ? n.flatMap(walk)
      : [n, ...walk(n.props?.children)];

const STATE: PanelState = {
  x: 100,
  y: 80,
  w: 320,
  h: 400,
  collapsed: false,
  z: 3,
};
const base = {
  id: "terminal" as const,
  title: "SESSION // JARVIS",
  state: STATE,
  focused: true,
  onChange: vi.fn(),
  onFocus: vi.fn(),
  children: <div>body</div>,
};

describe("Panel", () => {
  it("positions itself from its state", () => {
    const el = Panel(base) as React.ReactElement<any>;
    expect(el.props.style).toMatchObject({
      left: 100,
      top: 80,
      width: 320,
      zIndex: 3,
    });
  });

  it("renders the title and the body", () => {
    const html = renderToStaticMarkup(<Panel {...base} />);
    expect(html).toContain("SESSION // JARVIS");
    expect(html).toContain("body");
  });

  it("renders a corner-bracket frame, not a rounded card", () => {
    const html = renderToStaticMarkup(<Panel {...base} />);
    expect(html).toContain("hud-frame");
    expect(html).not.toMatch(/rounded-(?!full)/);
  });

  it("drops to the unfocused fill when not focused", () => {
    const on = renderToStaticMarkup(<Panel {...base} />);
    const off = renderToStaticMarkup(<Panel {...base} focused={false} />);
    expect(on).toContain("bg-panel/95");
    expect(off).toContain("bg-panel/80");
  });

  it("keeps title, frame and border lit when not focused", () => {
    const off = renderToStaticMarkup(<Panel {...base} focused={false} />);
    expect(off).toContain(LBL_CY);
    expect(off).not.toContain("hud-frame-dim");
    expect(off).toContain("border-accent/20");
  });

  it("collapses to the title bar, hiding the body and the resize grip", () => {
    const state = { ...STATE, collapsed: true };
    const html = renderToStaticMarkup(<Panel {...base} state={state} />);
    expect(html).toContain("SESSION // JARVIS");
    expect(html).not.toContain("body");
    // the grip lives in the same conditional block as the body; assert it
    // directly rather than inferring its absence
    expect(html).not.toContain("panel-grip-terminal");
    expect(renderToStaticMarkup(<Panel {...base} />)).toContain(
      "panel-grip-terminal",
    );
    const el = Panel({ ...base, state }) as React.ReactElement<any>;
    expect(el.props.style.height).toBe(TITLE_BAR_H);
  });

  it("collapses to compactWidth with its body intact when one is given", () => {
    const state = { ...STATE, collapsed: true };
    const el = Panel({
      ...base,
      state,
      compactWidth: 200,
    }) as React.ReactElement<any>;
    expect(el.props.style.width).toBe(200);
    // narrows from the left: the right edge stays where it was
    expect(el.props.style.left).toBe(STATE.x + STATE.w - 200);
    expect(el.props.style.left + 200).toBe(STATE.x + STATE.w);
    expect(el.props.style.height).toBeUndefined(); // shrink-wraps the body
    const html = renderToStaticMarkup(
      <Panel {...base} state={state} compactWidth={200} />,
    );
    expect(html).toContain("body");
    // fixed size while compact, so the resize handles stay away
    expect(html).not.toContain("panel-grip-terminal");
  });

  it("drags a compact panel by the box on screen, not the one it expands to", () => {
    const onChange = vi.fn();
    // full height and hard against the right edge: clamping this against the
    // expanded geometry would pin it, which is the bug under test
    const state: PanelState = {
      ...STATE,
      x: 1024 - 10 - 320,
      y: 10,
      h: 748,
      collapsed: true,
    };
    const el = Panel({
      ...base,
      state,
      compactWidth: 200,
      onChange,
    }) as React.ReactElement<any>;
    const bar = walk(el).find(
      (n: any) =>
        n.props?.onPointerDown && n.props.className?.includes?.("cursor-move"),
    );
    bar.props.onPointerDown({
      clientX: 500,
      clientY: 500,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    window.dispatchEvent(
      Object.assign(new Event("pointerup"), { clientX: 460, clientY: 560 }),
    );
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.x).toBe(state.x - 40); // moved left
    expect(next.y).toBe(state.y + 60); // and down, which the tall box forbade
    expect(next.w).toBe(state.w); // the expanded geometry is preserved
    expect(next.h).toBe(state.h);
  });

  it("folds a left-docked panel toward its left edge", () => {
    const state = { ...STATE, collapsed: true };
    const left = Panel({
      ...base,
      state,
      foldTo: "left",
    }) as React.ReactElement<any>;
    // no translation: the fold keeps the origin and shrinks to the right
    expect(left.props.style.left).toBe(state.x);
    // the default folds the other way, holding the expanded box's right edge
    const right = Panel({
      ...base,
      state,
      compactWidth: 200,
    }) as React.ReactElement<any>;
    expect(right.props.style.left).toBe(state.x + state.w - 200);
  });

  it("plays the exit when the deck is cleared", () => {
    // the node is dropped PANEL_OUT_MS later; this suite's fake useState never
    // advances, so tests/ui/Panel.close.test.tsx covers the drop itself
    const el = Panel({ ...base, hidden: true }) as any;
    expect(el).not.toBeNull();
    expect(String(el.props.className)).toContain("panel-out");
  });

  it("collapses through onChange when the caret is clicked", () => {
    const onChange = vi.fn();
    const caret = walk(Panel({ ...base, onChange })).find(
      (n: any) => n.props?.["data-testid"] === "panel-collapse-terminal",
    );
    expect(caret).toBeDefined();
    caret.props.onClick();
    expect(onChange).toHaveBeenCalledWith({ ...STATE, collapsed: true });
  });

  it("expands again from the collapsed state", () => {
    const onChange = vi.fn();
    const state = { ...STATE, collapsed: true };
    const caret = walk(Panel({ ...base, state, onChange })).find(
      (n: any) => n.props?.["data-testid"] === "panel-collapse-terminal",
    );
    caret.props.onClick();
    expect(onChange).toHaveBeenCalledWith({ ...STATE, collapsed: false });
  });

  it("does not start a title-bar drag from the caret", () => {
    const stopPropagation = vi.fn();
    const caret = walk(Panel(base)).find(
      (n: any) => n.props?.["data-testid"] === "panel-collapse-terminal",
    );
    caret.props.onPointerDown({ stopPropagation });
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("shows a close control only when onClose is given", () => {
    expect(renderToStaticMarkup(<Panel {...base} />)).not.toContain(
      "panel-close-terminal",
    );
    expect(
      renderToStaticMarkup(<Panel {...base} onClose={vi.fn()} />),
    ).toContain("panel-close-terminal");
  });

  it("raises itself on a pointer down anywhere in the panel", () => {
    const onFocus = vi.fn();
    const el = Panel({ ...base, onFocus }) as React.ReactElement<any>;
    el.props.onPointerDownCapture({ stopPropagation: vi.fn() });
    expect(onFocus).toHaveBeenCalled();
  });

  // the title bar and the resize handles stopPropagation to claim the drag, so
  // a bubbling focus handler would raise on a body press but not on the grip
  it("raises on the capture phase, so a title-bar drag raises too", () => {
    const el = Panel({ ...base, onFocus: vi.fn() }) as React.ReactElement<any>;
    expect(el.props.onPointerDownCapture).toBeDefined();
    expect(el.props.onPointerDown).toBeUndefined();
  });
});

describe("enterClass", () => {
  const render = (enterClass?: string) =>
    renderToStaticMarkup(
      <Panel
        id="terminal"
        title="SESSION"
        state={STATE}
        focused={true}
        enterClass={enterClass}
        onChange={() => {}}
        onFocus={() => {}}
      >
        <div />
      </Panel>,
    );

  it("adds nothing when absent", () => {
    expect(render(undefined)).not.toContain("boot-in");
  });

  it("merges the class into the panel root", () => {
    const html = render("boot-in");
    expect(html).toContain("boot-in");
    // still the panel root, not a wrapper — the inline left/top must stay on
    // the same element that carries the class
    expect(html).toContain('data-testid="panel-terminal"');
    expect(html.indexOf("boot-in")).toBeLessThan(
      html.indexOf('data-testid="panel-terminal"') + 400,
    );
  });
});
