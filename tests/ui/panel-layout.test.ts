import { describe, expect, it } from "vitest";
import {
  ASK_Z,
  BEZEL_INSET,
  MIN_H,
  MIN_W,
  SETTINGS_Z,
  SNAP_PX,
  TITLE_BAR_H,
  TOP_INSET,
  Z_BASE,
  clampAll,
  clampToViewport,
  defaultPanel,
  grabTarget,
  movePanel,
  panelAt,
  raise,
  rescaleAll,
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
  it("gives settings a fixed 250px width at any window size", () => {
    expect(defaultPanel("settings", VP).w).toBe(250);
    expect(
      defaultPanel("settings", { width: VP.width * 2, height: VP.height }).w,
    ).toBe(250);
  });

  it("sizes every panel as a fraction of the window, full height", () => {
    for (const id of ["terminal", "preview"] as const) {
      const p = defaultPanel(id, VP);
      // no fixed pixel sizes: doubling the window doubles the panel
      const big = defaultPanel(id, { width: VP.width * 2, height: VP.height });
      expect(big.w).toBeCloseTo(p.w * 2, 0);
      // every panel runs from the top line down to the bezel inset
      expect(p.y + p.h).toBe(VP.height - BEZEL_INSET);
    }
  });

  it("docks terminal and settings flush against the right frame", () => {
    for (const id of ["terminal", "settings"] as const)
      expect(defaultPanel(id, VP).x + defaultPanel(id, VP).w).toBe(
        VP.width - BEZEL_INSET,
      );
  });

  it("opens the terminal folded, and nothing else", () => {
    expect(defaultPanel("terminal", VP).collapsed).toBe(true);
    expect(defaultPanel("preview", VP).collapsed).toBe(false);
    expect(defaultPanel("settings", VP).collapsed).toBe(false);
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

  it("gives the mouth picker a default panel inside the viewport", () => {
    const vp = { width: 1600, height: 900 };
    const p = defaultPanel("mouth", vp);
    expect(p.w).toBeGreaterThan(0);
    expect(p.x + p.w).toBeLessThanOrEqual(vp.width);
    expect(p.collapsed).toBe(false);
  });
});

describe("clampToViewport", () => {
  it("pulls a panel saved off the right edge back on screen", () => {
    const p = clampToViewport(at(5000, 100), VP);
    expect(p.x + p.w).toBeLessThanOrEqual(VP.width - BEZEL_INSET);
  });

  it("pulls a panel saved above the top edge back on screen", () => {
    expect(clampToViewport(at(100, -500), VP).y).toBe(TOP_INSET);
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

  it("snaps a folded panel by its title bar width", () => {
    const box = { w: 180, h: TITLE_BAR_H };
    const p = at(VP.width - BEZEL_INSET - box.w - (SNAP_PX - 1), 300);
    expect(snapToEdges(p, VP, box).x + box.w).toBe(VP.width - BEZEL_INSET);
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

  it("clamps a folded panel by its title bar, not its expanded box", () => {
    // full height and full width: without the box it cannot move at all
    const p = at(BEZEL_INSET, TOP_INSET, 300, 846);
    const box = { w: 180, h: TITLE_BAR_H };
    const next = movePanel(p, 9999, 9999, VP, box);
    expect(next.y).toBe(VP.height - BEZEL_INSET - TITLE_BAR_H);
    expect(next.x).toBe(VP.width - BEZEL_INSET - box.w);
    expect(next.w).toBe(p.w); // the expanded geometry survives the move
    expect(next.h).toBe(p.h);
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

  it("moves the origin on the west/north handles, holding the far edge", () => {
    const p = resizePanel(at(100, 100, 300, 400), -40, -25, VP, "nw");
    expect(p).toMatchObject({ x: 60, y: 75, w: 340, h: 425 });
  });

  it("keeps the far edge still when a west drag hits the minimum", () => {
    const p = resizePanel(at(100, 100, 300, 400), 9999, 0, VP, "w");
    expect(p.w).toBe(MIN_W);
    expect(p.x + p.w).toBe(400); // where the right edge started
  });

  it("clamps a west drag at the bezel instead of widening past it", () => {
    const p = resizePanel(at(100, 100, 300, 400), -9999, 0, VP, "w");
    expect(p.x).toBe(BEZEL_INSET);
    expect(p.x + p.w).toBe(400);
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

  it("is a no-op for a panel already on top and normalised", () => {
    const panels: PanelMap = {
      terminal: at(0, 0, 300, 400, Z_BASE + 1),
      preview: at(0, 0, 300, 400, Z_BASE),
    };
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
    expect(grabTarget(panels, { x: 120, y: 105 }, undefined)).toBe("terminal");
  });

  it("returns null for a pinch that closed over bare ground — graph pans", () => {
    expect(grabTarget(panels, { x: 900, y: 800 }, undefined)).toBeNull();
  });

  it("keeps the latched panel as the hand wanders off the title bar", () => {
    expect(grabTarget(panels, { x: 900, y: 800 }, "terminal")).toBe("terminal");
  });

  it("keeps a decided no-grab, so a pan cannot yank a panel it sweeps over", () => {
    // null is a decision, not "undecided" — this is the whole reason the
    // parameter distinguishes null from undefined
    expect(grabTarget(panels, { x: 120, y: 105 }, null)).toBeNull();
  });

  it("returns null before any cursor has arrived", () => {
    expect(grabTarget(panels, null, undefined)).toBeNull();
  });
});

describe("TITLE_BAR_H", () => {
  it("is tall enough to be a hand-drag target", () => {
    expect(TITLE_BAR_H).toBeGreaterThanOrEqual(24);
  });
});

describe("z-index band (I2)", () => {
  it("defaultPanel starts inside the spec's 20-40 panel band", () => {
    for (const id of ["terminal", "preview", "settings"] as const) {
      const z = defaultPanel(id, VP).z;
      expect(z).toBeGreaterThanOrEqual(20);
      expect(z).toBeLessThanOrEqual(40);
    }
  });

  it("raise renormalises instead of growing without bound", () => {
    let panels: PanelMap = {
      terminal: at(0, 0, 300, 400, Z_BASE),
      preview: at(0, 0, 300, 400, Z_BASE + 1),
    };
    // toggle focus back and forth well past what `top + 1` could sustain
    // inside the 20-40 band
    for (let i = 0; i < 50; i++)
      panels = raise(panels, i % 2 === 0 ? "terminal" : "preview");
    for (const p of Object.values(panels)) {
      expect(p.z).toBeGreaterThanOrEqual(20);
      expect(p.z).toBeLessThanOrEqual(40);
    }
  });

  it("still puts the raised panel strictly above the others after renormalising", () => {
    const panels: PanelMap = {
      terminal: at(0, 0, 300, 400, Z_BASE),
      preview: at(0, 0, 300, 400, Z_BASE + 1),
      settings: at(0, 0, 300, 400, Z_BASE + 2),
    };
    const next = raise(panels, "terminal");
    expect(next.terminal!.z).toBeGreaterThan(next.preview!.z);
    expect(next.terminal!.z).toBeGreaterThan(next.settings!.z);
  });

  it("renormalises a lone legacy panel stuck below the band into it", () => {
    // a layout with exactly one panel ever focused/moved has a one-entry
    // map — `target.z === top` is trivially true there, so a stale z:1
    // (below the bezel at 10 and the overlay at 15) must still fall
    // through to renormalisation instead of short-circuiting as a no-op
    const panels: PanelMap = { terminal: at(0, 0, 300, 400, 1) };
    const next = raise(panels, "terminal");
    expect(next.terminal!.z).toBe(Z_BASE);
  });

  it("is a no-op for a one-entry map already normalised at Z_BASE", () => {
    const panels: PanelMap = { terminal: at(0, 0, 300, 400, Z_BASE) };
    expect(raise(panels, "terminal")).toBe(panels);
  });

  // App must persist raise's whole output, not just the focused entry. Keeping
  // only next[id] leaves the others on their old z until two tie — and a tie
  // satisfies `target.z === top && normalised`, so raise short-circuits from
  // then on and focus never reorders anything again.
  it("keeps z strictly ordered when the caller writes the whole map back", () => {
    let panels: PanelMap = {
      terminal: at(0, 0, 300, 400, Z_BASE),
      settings: at(0, 0, 300, 400, Z_BASE + 1),
    };
    for (const id of [
      "terminal",
      "settings",
      "terminal",
      "settings",
    ] as const) {
      panels = { ...panels, ...raise(panels, id) };
      const others = (Object.keys(panels) as Array<keyof typeof panels>)
        .filter((k) => k !== id)
        .map((k) => panels[k]!.z);
      expect(Math.min(...others)).toBeLessThan(panels[id]!.z);
    }
  });
});

describe("rescaleAll", () => {
  const from = { width: 1000, height: 700 };
  const to = { width: 2000, height: 1400 };

  it("keeps a right/bottom-docked panel docked when the window grows", () => {
    const docked = at(
      from.width - BEZEL_INSET - 400,
      from.height - BEZEL_INSET - 300,
      400,
      300,
    );
    const p = rescaleAll({ terminal: docked }, from, to).terminal!;
    expect(p.x + p.w).toBe(to.width - BEZEL_INSET);
    expect(p.y + p.h).toBe(to.height - BEZEL_INSET);
  });

  it("holds the settings width and its right dock when the window grows", () => {
    const docked = at(from.width - BEZEL_INSET - 250, TOP_INSET, 250, 600);
    const p = rescaleAll({ settings: docked }, from, to).settings!;
    expect(p.w).toBe(250);
    expect(p.x + p.w).toBe(to.width - BEZEL_INSET);
  });

  it("scales a panel's size with the window, not just its position", () => {
    const p = rescaleAll(
      { preview: at(510, 360, 400, 300) },
      from,
      to,
    ).preview!;
    const span = (v: number, lead: number) => v - lead - BEZEL_INSET;
    expect(p.w / 400).toBeCloseTo(
      span(to.width, BEZEL_INSET) / span(from.width, BEZEL_INSET),
      2,
    );
    expect(p.h / 300).toBeCloseTo(
      span(to.height, TOP_INSET) / span(from.height, TOP_INSET),
      2,
    );
    expect(p.x).toBeGreaterThan(510);
    expect(p.y).toBeGreaterThan(360);
  });

  it("shrinks a panel back down when the window shrinks", () => {
    const p = rescaleAll(
      { preview: at(510, 360, 400, 300) },
      to,
      from,
    ).preview!;
    expect(p.w).toBeLessThan(400);
    expect(p.h).toBeLessThan(300);
  });

  it("keeps an inset-flush panel flush", () => {
    const p = rescaleAll(
      { preview: at(BEZEL_INSET, TOP_INSET) },
      from,
      to,
    ).preview!;
    expect(p.x).toBe(BEZEL_INSET);
    expect(p.y).toBe(TOP_INSET);
  });

  it("only clamps when the viewport is unchanged", () => {
    const panels: PanelMap = { preview: at(100, 100) };
    expect(rescaleAll(panels, from, from).preview).toBe(panels.preview);
  });
});

describe("the reserved top line", () => {
  it("never lets a drag put a panel over the header row", () => {
    expect(movePanel(at(100, TOP_INSET), 0, -999, VP).y).toBe(TOP_INSET);
  });

  it("never lets a north resize grow a panel over it", () => {
    expect(resizePanel(at(100, TOP_INSET + 50), 0, -999, VP, "n").y).toBe(
      TOP_INSET,
    );
  });

  it("snaps the top edge to it, not to the bezel inset", () => {
    expect(snapToEdges(at(100, TOP_INSET + SNAP_PX - 1), VP).y).toBe(TOP_INSET);
  });
});

describe("the ask panel's geometry", () => {
  it("centres a fixed 560x420 box", () => {
    const p = defaultPanel("ask", { width: 1600, height: 1000 });
    expect(p.w).toBe(560);
    expect(p.h).toBe(420);
    expect(p.x).toBe(Math.round((1600 - 560) / 2));
    expect(p.y).toBe(Math.round((1000 - 420) / 2));
  });

  it("outranks settings", () => {
    expect(ASK_Z).toBeGreaterThan(SETTINGS_Z);
  });

  it("keeps its width when the window resizes", () => {
    const from = { width: 1600, height: 1000 };
    const to = { width: 2400, height: 1000 };
    const out = rescaleAll({ ask: defaultPanel("ask", from) }, from, to);
    expect(out.ask!.w).toBe(560);
  });
});
