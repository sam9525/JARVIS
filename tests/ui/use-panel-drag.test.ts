// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = (await vi.importActual("react")) as any;
  return {
    ...actual,
    useRef: (init: any) => ({ current: init }),
    useCallback: (fn: any) => fn,
    useEffect: () => {},
  };
});

import { usePanelDrag } from "../../src/renderer/ui/use-panel-drag";
import type { PanelState } from "../../src/shared/types";

// jsdom's window is 1024x768; this panel sits clear of every edge so no clamp
// or snap fires and the arithmetic under test is the only thing moving it
const STATE: PanelState = {
  x: 400,
  y: 300,
  w: 320,
  h: 400,
  collapsed: false,
  z: 1,
};

const down = (x: number, y: number) =>
  ({
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }) as any;

const fire = (type: string, x: number, y: number) =>
  window.dispatchEvent(
    Object.assign(new Event(type), { clientX: x, clientY: y }),
  );

describe("usePanelDrag", () => {
  it("settles on the release event's position, not one render behind", () => {
    const onChange = vi.fn();
    const drag = usePanelDrag({ state: STATE, onChange });
    drag.onTitlePointerDown(down(1000, 1000));
    fire("pointermove", 1050, 1000); // +50
    fire("pointerup", 1120, 1000); // +120 — the movement that must not be lost
    expect(onChange.mock.calls.at(-1)![0].x).toBe(STATE.x + 120);
  });

  it("stops listening after release", () => {
    const onChange = vi.fn();
    const drag = usePanelDrag({ state: STATE, onChange });
    drag.onTitlePointerDown(down(1000, 1000));
    fire("pointerup", 1010, 1000);
    onChange.mockClear();
    fire("pointermove", 1200, 1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("detaches on pointercancel", () => {
    const onChange = vi.fn();
    const drag = usePanelDrag({ state: STATE, onChange });
    drag.onTitlePointerDown(down(1000, 1000));
    fire("pointercancel", 1000, 1000);
    onChange.mockClear();
    fire("pointermove", 1200, 1000);
    fire("pointerup", 1200, 1000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not stack listeners across two drags", () => {
    const onChange = vi.fn();
    const drag = usePanelDrag({ state: STATE, onChange });
    drag.onTitlePointerDown(down(1000, 1000));
    drag.onTitlePointerDown(down(1000, 1000));
    onChange.mockClear();
    fire("pointermove", 1050, 1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("resizes from the grip, leaving the origin fixed and not snapping", () => {
    const onChange = vi.fn();
    const drag = usePanelDrag({ state: STATE, onChange });
    drag.onGripPointerDown(down(1000, 1000));
    fire("pointerup", 1040, 1030);
    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ x: STATE.x, y: STATE.y, w: 360, h: 430 });
  });
});
