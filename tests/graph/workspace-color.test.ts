import { describe, it, expect } from "vitest";
import {
  hexToHue,
  hueFrom,
  hueToHex,
  colourGap,
  distinctMains,
  hexGap,
  MIN_DELTA_E,
  nextHue,
  pickHue,
  pickHues,
  RECENT_PICKS,
  hueOfWorkspace,
  RESERVED,
  workspaceHue,
} from "../../src/renderer/graph/workspace-color";
import { fleetDomains } from "../../src/renderer/graph/fleet-graph";

// shortest way around the wheel: hues 350 and 10 are 20 apart, not 340
const apart = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// closest pair by how different the colours look, not by degrees
const nearestPair = (hues: number[]) => {
  let worst = Infinity;
  for (let i = 0; i < hues.length; i++)
    for (let j = i + 1; j < hues.length; j++)
      worst = Math.min(worst, colourGap(hues[i], hues[j]));
  return worst;
};

const FREE = Array.from({ length: 360 }, (_, h) => h).filter(
  (h) => !RESERVED.some(([lo, hi]) => h >= lo && h <= hi),
);

// asserts on the closest pair only, so a failure names the two hues that clashed
const allApart = (hues: number[], min: number) => {
  let worst = 360;
  let pair = "";
  for (let i = 0; i < hues.length; i++)
    for (let j = i + 1; j < hues.length; j++) {
      const d = apart(hues[i], hues[j]);
      if (d < worst) {
        worst = d;
        pair = `${hues[i]} vs ${hues[j]}`;
      }
    }
  expect({ pair, ok: worst > min }).toEqual({ pair, ok: true });
};

describe("hueFrom", () => {
  it("index 0 is the base hue itself", () => {
    expect(hueFrom(207, 0, 4)).toBe(207);
  });

  it("spaces every count from 2 to 10 more than 25 degrees apart", () => {
    for (let count = 2; count <= 10; count++) {
      const hues = Array.from({ length: count }, (_, i) =>
        hueFrom(0, i, count),
      );
      allApart(hues, 25);
    }
  });

  // Clamping a banded hue to the band's nearer edge collapsed a whole band
  // onto one degree, so a big enough count handed two domains one colour.
  it("gives every domain its own hue well past a real folder count", () => {
    for (const count of [26, 30, 36, 40, 60]) {
      const hues = Array.from({ length: count }, (_, i) =>
        hueFrom(0, i, count),
      );
      expect({ count, unique: new Set(hues).size }).toEqual({
        count,
        unique: count,
      });
    }
  });

  it("never lands on a hue reserved for a highlight colour", () => {
    for (let count = 2; count <= 12; count++)
      for (let i = 0; i < count; i++) {
        const h = hueFrom(0, i, count);
        for (const [lo, hi] of RESERVED) expect(h >= lo && h <= hi).toBe(false);
      }
  });

  it("is stable — the same arguments always give the same hue", () => {
    expect(hueFrom(90, 5, 8)).toBe(hueFrom(90, 5, 8));
  });

  it("treats count 0 or 1 as a single hue rather than dividing by zero", () => {
    expect(hueFrom(90, 0, 0)).toBe(90);
    expect(hueFrom(90, 0, 1)).toBe(90);
  });
});

describe("workspaceHue", () => {
  const ids = ["aerograph", "jarvis", "obsidian", "pokemon-tcg-pocket-data"];

  it("gives two different workspaces two different hues", () => {
    allApart(
      ids.map((id) => workspaceHue(id, ids)),
      25,
    );
  });

  it("does not depend on the order the ids arrive in", () => {
    expect(workspaceHue("obsidian", [...ids].reverse())).toBe(
      workspaceHue("obsidian", ids),
    );
  });

  it("falls back to the first hue for an id that is not in the list", () => {
    expect(workspaceHue("ghost", ids)).toBe(hueFrom(0, 0, ids.length));
  });
});

describe("hueToHex", () => {
  it("returns a #rrggbb string, which brighten() requires", () => {
    expect(hueToHex(207)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("different hues give different colours", () => {
    expect(hueToHex(0)).not.toBe(hueToHex(120));
  });
});

describe("hexToHue", () => {
  it("round-trips a hue through hueToHex", () => {
    for (const h of [0, 45, 120, 207, 300]) {
      const back = hexToHue(hueToHex(h));
      expect(back === null ? -1 : Math.abs(back - h)).toBeLessThan(2);
    }
  });

  it("returns null for grey, which has no hue to crowd", () => {
    expect(hexToHue("#4a5568")).not.toBeNull(); // slate still has a hue
    expect(hexToHue("#808080")).toBeNull();
    expect(hexToHue("not a colour")).toBeNull();
  });
});

describe("nextHue", () => {
  it("falls back to the workspace hue when no group has a colour yet", () => {
    expect(nextHue([], 207)).toBe(207);
  });

  it("picks the free hue whose nearest used colour is furthest away", () => {
    const used = [0, 90];
    const picked = nextHue(used.map((h) => hueToHex(h)));
    const room = (h: number) => Math.min(...used.map((u) => colourGap(h, u)));
    for (const h of FREE) expect(room(h)).toBeLessThanOrEqual(room(picked));
  });

  it("keeps clear of its own graph's colours before anyone else's", () => {
    // the other projects' colours fill the wheel; the own graph holds only 81
    const others = [0, 60, 120, 160, 220, 260, 300, 340].map((h) =>
      hueToHex(h),
    );
    const picked = nextHue(others, 0, [81]);
    expect(colourGap(picked, 81)).toBeGreaterThanOrEqual(MIN_DELTA_E);
  });

  it("stays clear of every colour already in use", () => {
    const used = [0, 40, 80, 300];
    const picked = nextHue(used.map((h) => hueToHex(h)));
    for (const u of used)
      expect(colourGap(picked, u)).toBeGreaterThanOrEqual(MIN_DELTA_E);
  });

  it("never returns a hue reserved for a highlight colour", () => {
    // two hues whose widest gap is centred on the cyan band
    const picked = nextHue([hueToHex(160), hueToHex(215)].concat(hueToHex(20)));
    for (const [lo, hi] of RESERVED)
      expect(picked >= lo && picked <= hi).toBe(false);
  });
});

describe("colourGap", () => {
  it("scores the red and orange pair that sets the minimum at about 11", () => {
    expect(Math.round(colourGap(0, 25))).toBe(MIN_DELTA_E);
  });

  // the jarvis src/ and tests/ greens: 56 degrees apart, one colour to the eye
  it("scores two greens far apart in degrees below the minimum", () => {
    expect(colourGap(81, 137)).toBeLessThan(MIN_DELTA_E);
  });
});

describe("pickHue", () => {
  it("varies — it is a draw, not a formula", () => {
    const seen = new Set(Array.from({ length: 30 }, () => pickHue([])));
    expect(seen.size).toBeGreaterThan(5);
  });

  it("clears every recent pick by MIN_DELTA_E while the wheel has room", () => {
    const recent = [0, 81, 240];
    for (let i = 0; i < 50; i++) {
      const h = pickHue(recent);
      for (const r of recent)
        expect(colourGap(h, r)).toBeGreaterThanOrEqual(MIN_DELTA_E);
    }
  });

  it("never draws a band edge more often than any other free hue", () => {
    const edges = Array.from({ length: 3000 }, () => pickHue([])).filter((h) =>
      [9, 41, 171, 203].includes(h),
    ).length;
    // uniform over 298 free hues: about 40 of 3000, where clamping gave ~350
    expect(edges).toBeLessThan(100);
  });

  it("forgets a pick once twelve newer ones have gone by", () => {
    // 90 is the oldest of thirteen, so it drops out of the window and a draw
    // may legally land on it again
    const log = [90, ...Array.from({ length: 12 }, (_, i) => i * 25 + 5)];
    const banned = log.slice(-RECENT_PICKS);
    expect(banned).not.toContain(90);
  });

  it("still answers when the ban list covers the whole wheel", () => {
    const wall = Array.from({ length: 12 }, (_, i) => i * 30);
    const h = pickHue(wall);
    expect(Number.isFinite(h)).toBe(true);
    for (const [lo, hi] of RESERVED) expect(h >= lo && h <= hi).toBe(false);
  });

  it("never lands in a hue band the highlight layer owns", () => {
    for (let i = 0; i < 100; i++) {
      const h = pickHue([]);
      for (const [lo, hi] of RESERVED) expect(h >= lo && h <= hi).toBe(false);
    }
  });
});

describe("pickHues", () => {
  // five fit at MIN_DELTA_E; a sixth may have to settle a little closer,
  // since the free wheel holds only about eight such hues
  it("keeps its own draws apart, not just apart from the log", () => {
    for (let run = 0; run < 20; run++) {
      expect(nearestPair(pickHues(5))).toBeGreaterThanOrEqual(
        MIN_DELTA_E - 0.5,
      );
      expect(nearestPair(pickHues(6))).toBeGreaterThanOrEqual(9);
    }
  });

  it("continues an existing log", () => {
    const recent = [10, 70, 130];
    // a third pick can find no hue clear of all five and fall back to the
    // roomiest one, so two picks is what the log can always take
    const out = pickHues(2, recent);
    for (const h of out)
      for (const r of recent)
        expect(colourGap(h, r)).toBeGreaterThanOrEqual(MIN_DELTA_E);
  });

  // 13 groups cannot all look different — the wheel holds about eight — so
  // the colours that share a graph are the ones kept apart
  it("keeps each project's groups apart: three projects of 3, 3 and 7", () => {
    for (let run = 0; run < 20; run++) {
      let log: number[] = [];
      for (const n of [3, 3, 7]) {
        const hues = pickHues(n, log);
        expect(nearestPair(hues)).toBeGreaterThanOrEqual(8);
        log = [...log, ...hues].slice(-RECENT_PICKS);
      }
    }
  });

  it("returns nothing for a count of zero", () => {
    expect(pickHues(0)).toEqual([]);
  });
});

describe("hueOfWorkspace", () => {
  const ws = (id: string, name: string) => ({
    id,
    name,
    rootPath: id,
    kind: "vault" as const,
    sourceId: "vault",
  });
  const fleet = [ws("d:/a", "alpha"), ws("d:/b", "beta")];

  it("uses the stored main colour — the first hue that project drew", () => {
    expect(hueOfWorkspace(fleet[0], fleet, { "d:/a": hueToHex(207) })).toBe(
      207,
    );
  });

  it("falls back to the spread for a workspace that has not seeded yet", () => {
    expect(hueOfWorkspace(fleet[1], fleet, {})).toBe(
      workspaceHue("beta", fleetDomains(fleet)),
    );
  });

  it("ignores a stored colour that has no hue, rather than drawing grey", () => {
    expect(hueOfWorkspace(fleet[0], fleet, { "d:/a": "#808080" })).toBe(
      workspaceHue("alpha", fleetDomains(fleet)),
    );
  });
});

describe("hexGap", () => {
  it("reads #e1bf70 and #e1bd70 as one yellow", () => {
    expect(hexGap("#e1bf70", "#e1bd70")).toBeLessThan(MIN_DELTA_E);
  });

  it("tells one hue at two lightnesses apart", () => {
    expect(hexGap("#e1bd70", "#7a5a10")).toBeGreaterThan(MIN_DELTA_E);
  });
});

describe("distinctMains", () => {
  it("redraws the later of two near-identical yellows and keeps the first", () => {
    const out = distinctMains({ vault: "#e1bf70", jarvis: "#e1bd70" });
    expect(out.vault).toBe("#e1bf70");
    expect(hexGap(out.vault, out.jarvis)).toBeGreaterThanOrEqual(MIN_DELTA_E);
  });

  it("keeps colours that already look different", () => {
    const mains = { a: hueToHex(60), b: hueToHex(240) };
    expect(distinctMains(mains)).toEqual(mains);
  });

  it("keeps the redrawn colour off the project's own other groups", () => {
    const own = { jarvis: ["#e1bd70", hueToHex(260)] };
    const out = distinctMains({ vault: "#e1bf70", jarvis: "#e1bd70" }, own);
    expect(hexGap(out.jarvis, hueToHex(260))).toBeGreaterThanOrEqual(
      MIN_DELTA_E,
    );
  });

  // a real settings file: twelve projects, three pairs under ΔE 1
  const twelve = [
    "#e1bf70",
    "#e18170",
    "#df70e1",
    "#7094e1",
    "#70e1d0",
    "#70e1a3",
    "#70b5e1",
    "#707de1",
    "#e170b4",
    "#e170e1",
    "#e17d70",
    "#e1bd70",
  ];
  const mains = Object.fromEntries(twelve.map((c, i) => [`p${i}`, c]));

  it("gives twelve projects no near-identical pair, past the wheel's eight clear hues", () => {
    const out = Object.values(distinctMains(mains));
    let worst = Infinity;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        worst = Math.min(worst, hexGap(out[i], out[j]));
    expect(worst).toBeGreaterThan(5);
  });

  it("changes nothing on a second pass, so the settings effect cannot loop", () => {
    const once = distinctMains(mains);
    expect(distinctMains(once)).toEqual(once);
  });
});
