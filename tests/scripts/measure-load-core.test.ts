import { describe, it, expect } from "vitest";
import {
  CSV_HEADER,
  buildRows,
  gpuByPid,
  groupOf,
  makeGuard,
  protectedRoots,
  sessionRoots,
  toCsvLine,
  treePids,
} from "../../scripts/measure-load-core.mjs";

const proc = (pid: number, ppid: number, name: string, cmd = name) => ({
  pid,
  ppid,
  name,
  cmd,
  ws: 10 * 1048576,
  priv: 5 * 1048576,
  cpu: 1,
});

const procs = [
  proc(100, 1, "electron.exe"),
  proc(101, 100, "electron.exe", "electron.exe --type=renderer"),
  proc(102, 100, "electron.exe", "electron.exe --type=gpu-process"),
  proc(103, 100, "electron.exe", "electron.exe --type=utility"),
  proc(110, 100, "cmd.exe", "cmd.exe /c claude --model sonnet"),
  proc(111, 110, "claude.exe"),
  proc(112, 111, "node.exe", "node gitnexus mcp"),
  proc(113, 100, "OpenConsole.exe"),
  proc(200, 1, "chrome.exe"),
];
const byPid = (pid: number) => procs.find((p) => p.pid === pid) ?? procs[0];

describe("measure-load-core", () => {
  it("treePids returns the root and its descendants only", () => {
    expect([...treePids(procs, 100)].sort()).toEqual([
      100, 101, 102, 103, 110, 111, 112, 113,
    ]);
  });

  it("groupOf classifies each process", () => {
    expect(groupOf(byPid(100), procs, 100)).toBe("main");
    expect(groupOf(byPid(101), procs, 100)).toBe("window");
    expect(groupOf(byPid(102), procs, 100)).toBe("gpu");
    expect(groupOf(byPid(103), procs, 100)).toBe("utility");
    expect(groupOf(byPid(110), procs, 100)).toBe("session");
    expect(groupOf(byPid(111), procs, 100)).toBe("session");
    expect(groupOf(byPid(112), procs, 100)).toBe("mcp");
    expect(groupOf(byPid(113), procs, 100)).toBe("conpty");
    expect(groupOf(byPid(200), procs, 100)).toBe("other");
  });

  it("sessionRoots finds one pid per PTY", () => {
    expect(sessionRoots(procs, 100)).toEqual([110]);
  });

  it("a cmd.exe running anything but claude is not a session root", () => {
    const withGitnexus = [
      ...procs,
      proc(
        120,
        100,
        "cmd.exe",
        'C:\\WINDOWS\\system32\\cmd.exe /d /s /c "gitnexus cypher MATCH (n) RETURN n"',
      ),
      proc(121, 120, "node.exe", "node gitnexus cypher"),
    ];
    expect(sessionRoots(withGitnexus, 100)).toEqual([110]);
    expect(groupOf(withGitnexus[9], withGitnexus, 100)).toBe("other");
    expect(groupOf(withGitnexus[10], withGitnexus, 100)).toBe("other");
  });

  it("a cmd.exe /c claude child of main is a session root", () => {
    const shell = proc(
      130,
      100,
      "cmd.exe",
      "C:\\WINDOWS\\system32\\cmd.exe /c claude --model sonnet",
    );
    expect(sessionRoots([...procs, shell], 100)).toEqual([110, 130]);
    expect(groupOf(shell, [...procs, shell], 100)).toBe("session");
  });

  it("protectedRoots returns only roots outside the initial set", () => {
    expect(protectedRoots([110])([110, 120])).toEqual([120]);
  });

  it("gpuByPid sums per pid and ignores instances without a pid", () => {
    expect(
      gpuByPid([
        ["pid_101_luid_0x0_eng_0_engtype_3D", 30],
        ["pid_101_luid_0x0_eng_1_engtype_Copy", 5],
        ["_total", 99],
      ]).get(101),
    ).toBe(35);
    expect(gpuByPid([["_total", 99]]).size).toBe(0);
  });

  it("guard trips on RAM at once and on CPU after a sustained hold", () => {
    const g = makeGuard({ ramFloor: 0.1, ceiling: 95, holdSamples: 10 });
    expect(g({ freeRamFrac: 0.09, cpu: 10, gpu: 10 })).toBe("ram");

    const c = makeGuard({ ramFloor: 0.1, ceiling: 95, holdSamples: 10 });
    for (let i = 0; i < 9; i++) {
      expect(c({ freeRamFrac: 0.5, cpu: 96, gpu: 0 })).toBeNull();
    }
    expect(c({ freeRamFrac: 0.5, cpu: 96, gpu: 0 })).toBe("cpu");
  });

  it("guard trips on a sustained GPU load", () => {
    const g = makeGuard({ ramFloor: 0.1, ceiling: 95, holdSamples: 2 });
    expect(g({ freeRamFrac: 0.5, cpu: 0, gpu: 99 })).toBeNull();
    expect(g({ freeRamFrac: 0.5, cpu: 0, gpu: 99 })).toBe("gpu");
  });

  it("a dip below the ceiling resets the hold", () => {
    const r = makeGuard({ ramFloor: 0.1, ceiling: 95, holdSamples: 10 });
    for (let i = 0; i < 9; i++) r({ freeRamFrac: 0.5, cpu: 96, gpu: 0 });
    expect(r({ freeRamFrac: 0.5, cpu: 50, gpu: 0 })).toBeNull();
    expect(r({ freeRamFrac: 0.5, cpu: 96, gpu: 0 })).toBeNull();
  });

  it("buildRows leaves a blank cell for a pid with no cpu reading", () => {
    const rows = buildRows(
      "t",
      "S0",
      [{ ...procs[0], cpu: null }],
      100,
      new Map(),
      new Map(),
    );
    expect(rows[0][CSV_HEADER.indexOf("cpu_pct")]).toBe("");
    expect(rows[0][CSV_HEADER.indexOf("gpu_pct")]).toBe("");
  });

  it("buildRows emits one formatted row per tree pid", () => {
    const rows = buildRows(
      "t",
      "S1",
      procs,
      100,
      new Map([[102, 12.34]]),
      new Map([[102, 2097152]]),
    );
    expect(rows).toHaveLength(8);
    const gpuRow =
      rows.find((r) => r[CSV_HEADER.indexOf("pid")] === "102") ?? [];
    expect(gpuRow[CSV_HEADER.indexOf("group")]).toBe("gpu");
    expect(gpuRow[CSV_HEADER.indexOf("ws_mb")]).toBe("10.0");
    expect(gpuRow[CSV_HEADER.indexOf("gpu_pct")]).toBe("12.3");
    expect(gpuRow[CSV_HEADER.indexOf("gpu_mem_mb")]).toBe("2.0");
  });

  it("toCsvLine quotes fields per RFC 4180", () => {
    expect(toCsvLine(["a,b", 'say "hi"', "x"])).toBe('"a,b","say ""hi""",x');
    expect(toCsvLine(["a\nb"])).toBe('"a\nb"');
  });
});
