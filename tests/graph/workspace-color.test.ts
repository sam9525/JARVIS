import { describe, it, expect } from "vitest";
import {
  hexToHue,
  hueFrom,
  hueToHex,
  MIN_APART,
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
      const hues = Array.from({ length: count }, (_, i) => hueFrom(0, i, count));
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

  it("picks the middle of the widest gap", () => {
    expect(nextHue([hueToHex(0), hueToHex(90)])).toBe(225);
  });

  it("stays clear of every colour already in use", () => {
    const used = [0, 40, 80, 300].map((h) => hueToHex(h));
    const picked = nextHue(used);
    for (const u of used) {
      const uh = hexToHue(u) as number;
      const d = Math.abs(picked - uh) % 360;
      expect(d > 180 ? 360 - d : d).toBeGreaterThan(25);
    }
  });

  it("never returns a hue reserved for a highlight colour", () => {
    // two hues whose widest gap is centred on the cyan band
    const picked = nextHue([hueToHex(160), hueToHex(215)].concat(hueToHex(20)));
    for (const [lo, hi] of RESERVED)
      expect(picked >= lo && picked <= hi).toBe(false);
  });
});

describe("pickHue", () => {
  it("varies — it is a draw, not a formula", () => {
    const seen = new Set(Array.from({ length: 30 }, () => pickHue([])));
    expect(seen.size).toBeGreaterThan(5);
  });

  it("clears every one of the last ten picks by MIN_APART", () => {
    const recent = [0, 60, 120, 240, 300];
    for (let i = 0; i < 50; i++) {
      const h = pickHue(recent);
      for (const r of recent)
        expect(apart(h, r)).toBeGreaterThanOrEqual(MIN_APART);
    }
  });

  it("forgets a pick once ten newer ones have gone by", () => {
    // 90 is the oldest of eleven, so it drops out of the window and a draw
    // may legally land on it again
    const log = [90, ...Array.from({ length: 10 }, (_, i) => i * 30 + 5)];
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
  it("keeps its own draws apart, not just apart from the log", () => {
    for (let run = 0; run < 20; run++) allApart(pickHues(6), MIN_APART - 1);
  });

  it("continues an existing log", () => {
    const recent = [10, 70, 130];
    const out = pickHues(3, recent);
    for (const h of out)
      for (const r of recent)
        expect(apart(h, r)).toBeGreaterThanOrEqual(MIN_APART);
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
