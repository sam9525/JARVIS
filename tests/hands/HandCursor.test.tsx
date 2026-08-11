// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import HandCursor, {
  type HandCursorHandle,
} from "../../src/renderer/hands/HandCursor";

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

const el = () =>
  container.querySelector('[data-testid="hand-cursor"]') as HTMLElement | null;

describe("HandCursor", () => {
  it("seeds its position from props at mount", () => {
    act(() => {
      root.render(<HandCursor visible initialX={420} initialY={260} />);
    });
    expect(el()!.style.left).toBe("420px");
    expect(el()!.style.top).toBe("260px");
  });

  it("renders nothing when not visible", () => {
    act(() => {
      root.render(<HandCursor visible={false} initialX={0} initialY={0} />);
    });
    expect(el()).toBeNull();
  });

  it("never intercepts pointer events", () => {
    const html = renderToStaticMarkup(
      <HandCursor visible initialX={10} initialY={10} />,
    );
    expect(html).toContain("pointer-events-none");
  });

  // this is the behavior I8 depends on: per-frame position updates go
  // straight to the DOM through the imperative handle, not through React
  // state and a re-render
  it("moves via the imperative handle without a re-render", () => {
    const ref = React.createRef<HandCursorHandle>();
    act(() => {
      root.render(<HandCursor ref={ref} visible initialX={0} initialY={0} />);
    });
    act(() => {
      ref.current!.setPosition(88, 44);
    });
    expect(el()!.style.left).toBe("88px");
    expect(el()!.style.top).toBe("44px");
  });

  it("does nothing when the handle is called before the node is visible", () => {
    const ref = React.createRef<HandCursorHandle>();
    act(() => {
      root.render(
        <HandCursor ref={ref} visible={false} initialX={0} initialY={0} />,
      );
    });
    expect(() => ref.current?.setPosition(1, 1)).not.toThrow();
    expect(el()).toBeNull();
  });
});
