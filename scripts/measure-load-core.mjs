/**
 * @typedef {{ pid: number, ppid: number, name: string, cmd: string, ws: number, priv: number, cpu: number | null }} Proc
 * `ws` and `priv` are bytes; `cpu` is a percentage of the whole machine.
 */

export const CSV_HEADER = [
  "time",
  "scenario",
  "pid",
  "ppid",
  "name",
  "group",
  "cmd",
  "ws_mb",
  "private_mb",
  "cpu_pct",
  "gpu_pct",
  "gpu_mem_mb",
];

/**
 * @param {Proc[]} procs
 * @param {number} rootPid
 * @returns {Set<number>}
 */
export function treePids(procs, rootPid) {
  const tree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) {
      if (!tree.has(p.pid) && tree.has(p.ppid)) {
        tree.add(p.pid);
        grew = true;
      }
    }
  }
  return tree;
}

// JARVIS also runs `gitnexus` through a cmd.exe child of main, so a cmd.exe
// is a session only when it is the PTY's `cmd.exe /c claude …`.
const isSessionShell = (proc) =>
  proc.name === "claude.exe" ||
  (proc.name === "cmd.exe" && /\/c\s+claude\b/i.test(proc.cmd));

/**
 * @param {Proc[]} procs
 * @param {number} rootPid
 * @returns {number[]}
 */
export function sessionRoots(procs, rootPid) {
  return procs
    .filter((p) => p.ppid === rootPid && isSessionShell(p))
    .map((p) => p.pid);
}

/**
 * The session roots and every pid under them, walked once per sample.
 * @param {Proc[]} procs
 * @param {number} rootPid
 * @returns {{ roots: Set<number>, under: Set<number> }}
 */
export function sessionTrees(procs, rootPid) {
  const roots = sessionRoots(procs, rootPid);
  const under = new Set();
  for (const root of roots) {
    for (const pid of treePids(procs, root)) under.add(pid);
  }
  return { roots: new Set(roots), under };
}

/**
 * @param {Proc} proc
 * @param {Proc[]} procs
 * @param {number} rootPid
 * @param {{ roots: Set<number>, under: Set<number> }} [sessions] pass from `sessionTrees` when grouping many procs
 * @returns {"main" | "window" | "gpu" | "utility" | "session" | "mcp" | "conpty" | "other"}
 */
export function groupOf(
  proc,
  procs,
  rootPid,
  sessions = sessionTrees(procs, rootPid),
) {
  if (proc.pid === rootPid) return "main";
  if (proc.name === "electron.exe" && proc.cmd.includes("--type=")) {
    if (proc.cmd.includes("--type=renderer")) return "window";
    if (proc.cmd.includes("--type=gpu-process")) return "gpu";
    return "utility";
  }
  if (proc.name === "OpenConsole.exe" || proc.name === "conhost.exe") {
    return "conpty";
  }
  if (sessions.roots.has(proc.pid) || proc.name === "claude.exe") {
    return "session";
  }
  if (sessions.under.has(proc.pid)) return "mcp";
  return "other";
}

/**
 * Remembers the roots present at start so only later ones can be killed.
 * @param {number[]} initial
 * @returns {(roots: number[]) => number[]}
 */
export function protectedRoots(initial) {
  const protectedSet = new Set(initial);
  return (roots) => roots.filter((pid) => !protectedSet.has(pid));
}

/**
 * @param {[instance: string, value: number][]} samples
 * @returns {Map<number, number>}
 */
export function gpuByPid(samples) {
  const totals = new Map();
  for (const [instance, value] of samples) {
    const match = /pid_(\d+)_/.exec(instance);
    if (!match) continue;
    const pid = Number(match[1]);
    totals.set(pid, (totals.get(pid) ?? 0) + value);
  }
  return totals;
}

/**
 * RAM trips immediately; CPU and GPU trip only after `holdSamples`
 * consecutive samples above the ceiling, so a spike does not abort a run.
 * @param {{ ramFloor: number, ceiling: number, holdSamples: number }} limits
 * @returns {(t: { freeRamFrac: number, cpu: number, gpu: number }) => string | null}
 */
export function makeGuard({ ramFloor, ceiling, holdSamples }) {
  const streak = { cpu: 0, gpu: 0 };
  return ({ freeRamFrac, cpu, gpu }) => {
    if (freeRamFrac < ramFloor) return "ram";
    let tripped = null;
    for (const [key, value] of [
      ["cpu", cpu],
      ["gpu", gpu],
    ]) {
      streak[key] = value > ceiling ? streak[key] + 1 : 0;
      if (streak[key] >= holdSamples && tripped === null) tripped = key;
    }
    return tripped;
  };
}

export const toMb = (bytes) =>
  bytes === null || bytes === undefined ? "" : (bytes / 1048576).toFixed(1);
export const toPct = (value) =>
  value === null || value === undefined ? "" : value.toFixed(1);

/**
 * @param {string} ts
 * @param {string} scenario
 * @param {Proc[]} procs
 * @param {number} rootPid
 * @param {Map<number, number>} gpuUtil
 * @param {Map<number, number>} gpuMem bytes per pid
 * @returns {string[][]}
 */
export function buildRows(ts, scenario, procs, rootPid, gpuUtil, gpuMem) {
  const tree = treePids(procs, rootPid);
  const sessions = sessionTrees(procs, rootPid);
  return procs
    .filter((p) => tree.has(p.pid))
    .map((p) => [
      ts,
      scenario,
      String(p.pid),
      String(p.ppid),
      p.name,
      groupOf(p, procs, rootPid, sessions),
      p.cmd,
      toMb(p.ws),
      toMb(p.priv),
      toPct(p.cpu),
      toPct(gpuUtil.get(p.pid)),
      toMb(gpuMem.get(p.pid)),
    ]);
}

/**
 * @param {string[]} row
 * @returns {string}
 */
export function toCsvLine(row) {
  return row
    .map((field) =>
      /[",\n\r]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field,
    )
    .join(",");
}
