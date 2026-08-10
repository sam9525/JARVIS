import { describe, expect, it } from "vitest";
import {
  BEZEL_INSET,
  MIN_H,
  MIN_W,
  SNAP_PX,
  TITLE_BAR_H,
  clampAll,
  clampToViewport,
  defaultPanel,
  grabTarget,
  movePanel,
  panelAt,
  raise,
  resizePanel,
  snapToEdges,
  titleBarAt,
} from "../../src/renderer/ui/panel-layout";
import type { PanelMap, PanelState } from "../../src/shared/types";

const VP = { width: 1600, height: 900 };
const at = (x: number, y: number, w = 300, h = 400, z = 1): PanelState => ({
  x,
  y,
  w,
  h,
  collapsed: false,
  z,
});

describe("defaultPanel", () => {
  it("sizes preview and terminal to the spec's percentages", () => {
    const preview = defaultPanel("preview", VP);
    const terminal = defaultPanel("terminal", VP);
    expect(preview.w).toBeCloseTo(VP.width * 0.26, 0);
    expect(preview.h).toBeCloseTo(VP.height * 0.8, 0);
    expect(terminal.w).toBeCloseTo(VP.width * 0.31, 0);
    expect(terminal.h).toBeCloseTo(VP.height * 0.8, 0);
  });

  it("puts preview left and terminal right, leaving a centre channel", () => {
    const preview = defaultPanel("preview", VP);
    const terminal = defaultPanel("terminal", VP);
    expect(preview.x + preview.w).toBeLessThan(terminal.x);
  });

  it("never produces a panel that starts outside the viewport", () => {
    const tiny = { width: 400, height: 300 };
    for (const id of ["terminal", "preview", "settings"] as const) {
      const p = defaultPanel(id, tiny);
      expect(p.x).toBeGreaterThanOrEqual(BEZEL_INSET);
      expect(p.y).toBeGreaterThanOrEqual(BEZEL_INSET);
    }
  });
});

describe("clampToViewport", () => {
  it("pulls a panel saved off the right edge back on screen", () => {
    const p = clampToViewport(at(5000, 100), VP);
    expect(p.x + p.w).toBeLessThanOrEqual(VP.width - BEZEL_INSET);
  });

  it("pulls a panel saved above the top edge back on screen", () => {
    expect(clampToViewport(at(100, -500), VP).y).toBe(BEZEL_INSET);
  });

  it("shrinks a panel wider than the viewport", () => {
    const p = clampToViewport(at(0, 0, 9000, 9000), {
      width: 800,
      height: 600,
    });
    expect(p.w).toBeLessThanOrEqual(800 - BEZEL_INSET * 2);
    expect(p.h).toBeLessThanOrEqual(600 - BEZEL_INSET * 2);
  });

  it("never shrinks below the minimums, even on a tiny viewport", () => {
    const p = clampToViewport(at(0, 0, 300, 400), { width: 100, height: 100 });
    expect(p.w).toBe(MIN_W);
    expect(p.h).toBe(MIN_H);
    expect(p.x).toBe(BEZEL_INSET);
  });

  it("leaves an already-valid panel untouched", () => {
    const p = at(100, 100);
    expect(clampToViewport(p, VP)).toEqual(p);
  });
});

describe("snapToEdges", () => {
  it("snaps a near-left panel to the bezel inset", () => {
    expect(snapToEdges(at(BEZEL_INSET + SNAP_PX - 1, 300), VP).x).toBe(
      BEZEL_INSET,
    );
  });

  it("snaps a near-right panel flush to the right bezel", () => {
    const p = at(VP.width - 300 - BEZEL_INSET - (SNAP_PX - 1), 300);
    expect(snapToEdges(p, VP).x + p.w).toBe(VP.width - BEZEL_INSET);
  });

  it("leaves a panel in open space alone", () => {
    const p = at(600, 400);
    expect(snapToEdges(p, VP)).toEqual(p);
  });
});

describe("movePanel", () => {
  it("adds the delta and clamps in one step", () => {
    expect(movePanel(at(100, 100), 50, -30, VP)).toMatchObject({
      x: 150,
      y: 70,
    });
  });

  it("cannot be dragged off the left edge", () => {
    expect(movePanel(at(100, 100), -9999, 0, VP).x).toBe(BEZEL_INSET);
  });
});

describe("resizePanel", () => {
  it("grows from the bottom-right grip, leaving x/y fixed", () => {
    const p = resizePanel(at(100, 100, 300, 400), 40, 25, VP);
    expect(p).toMatchObject({ x: 100, y: 100, w: 340, h: 425 });
  });

  it("refuses to shrink past the minimums", () => {
    const p = resizePanel(at(100, 100, 300, 400), -9999, -9999, VP);
    expect(p.w).toBe(MIN_W);
    expect(p.h).toBe(MIN_H);
  });
});

describe("raise", () => {
  it("puts the named panel above every other", () => {
    const panels: PanelMap = {
      terminal: at(0, 0, 300, 400, 1),
      preview: at(0, 0, 300, 400, 5),
    };
    const next = raise(panels, "terminal");
    expect(next.terminal!.z).toBeGreaterThan(next.preview!.z);
  });

  it("is a no-op for a panel already on top", () => {
    const panels: PanelMap = { terminal: at(0, 0, 300, 400, 9) };
    expect(raise(panels, "terminal")).toEqual(panels);
  });

  it("ignores a panel that is not in the map", () => {
    const panels: PanelMap = { terminal: at(0, 0, 300, 400, 1) };
    expect(raise(panels, "settings")).toEqual(panels);
  });
});

describe("titleBarAt", () => {
  const panels: PanelMap = {
    terminal: at(100, 100, 300, 400, 1),
    preview: at(150, 110, 300, 400, 5),
  };

  it("finds the title bar under the point", () => {
    expect(titleBarAt({ terminal: panels.terminal }, 120, 105)).toBe(
      "terminal",
    );
  });

  it("returns null for a point in the panel body", () => {
    expect(titleBarAt({ terminal: panels.terminal }, 120, 300)).toBeNull();
  });

  it("returns null for a point on bare ground", () => {
    expect(titleBarAt(panels, 900, 800)).toBeNull();
  });

  it("prefers the topmost panel where two overlap", () => {
    expect(titleBarAt(panels, 200, 115)).toBe("preview");
  });

  it("treats a collapsed panel as title bar only", () => {
    const collapsed: PanelMap = {
      terminal: { ...at(100, 100, 300, 400), collapsed: true },
    };
    expect(titleBarAt(collapsed, 120, 105)).toBe("terminal");
    expect(panelAt(collapsed, 120, 300)).toBeNull();
  });
});

describe("panelAt", () => {
  it("hits anywhere inside an expanded panel", () => {
    const panels: PanelMap = { terminal: at(100, 100, 300, 400) };
    expect(panelAt(panels, 120, 300)).toBe("terminal");
    expect(panelAt(panels, 900, 300)).toBeNull();
  });
});

describe("clampAll", () => {
  it("re-clamps every panel when the viewport shrinks", () => {
    const panels: PanelMap = {
      terminal: at(1400, 700),
      preview: at(1200, 600),
    };
    const next = clampAll(panels, { width: 800, height: 600 });
    for (const p of Object.values(next)) {
      expect(p.x + p.w).toBeLessThanOrEqual(800 - BEZEL_INSET);
      expect(p.y + p.h).toBeLessThanOrEqual(600 - BEZEL_INSET);
    }
  });
});

describe("grabTarget", () => {
  const panels: PanelMap = { terminal: at(100, 100, 300, 400, 1) };

  it("latches the panel whose title bar the pinch closed over", () => {
    expect(grabTarget(panels, { x: 120, y: 105 }, null)).toBe("terminal");
  });

  it("returns null for a pinch that closed over bare ground — graph pans", () => {
    expect(grabTarget(panels, { x: 900, y: 800 }, null)).toBeNull();
  });

  it("keeps the latched panel as the hand wanders off the title bar", () => {
    expect(grabTarget(panels, { x: 900, y: 800 }, "terminal")).toBe("terminal");
  });

  it("returns null before any cursor has arrived", () => {
    expect(grabTarget(panels, null, null)).toBeNull();
  });
});

describe("TITLE_BAR_H", () => {
  it("is tall enough to be a hand-drag target", () => {
    expect(TITLE_BAR_H).toBeGreaterThanOrEqual(24);
  });
});
