// Sample the JARVIS process tree once a second into CSV, for the load study.
//
//   node scripts/measure-load.mjs --root <pid|auto> --scenario <S0..S5|label>
//     --out <dir> [--seconds <n>] [--user-data <dir>]
//
// Writes <out>/<scenario>.csv (one row per tree process per sample) and
// <out>/<scenario>.machine.csv (one row of machine totals per sample). Without
// --seconds it samples until Ctrl+C. MEASURE_LOAD_FORCE_GUARD=ram is test-only:
// it makes the guard see no free RAM.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import {
  CSV_HEADER,
  buildRows,
  gpuByPid,
  makeGuard,
  protectedRoots,
  sessionRoots,
  toCsvLine,
  toMb,
  toPct,
} from "./measure-load-core.mjs";

const MACHINE_HEADER = [
  "time",
  "scenario",
  "free_ram_mb",
  "total_ram_mb",
  "commit_mb",
  "cpu_pct",
  "gpu_pct",
  "guard",
];
const TICK_MS = 1000;
const CMD_MAX = 200;
const READ_DEADLINE_MS = 5 * TICK_MS;

// One long-lived PowerShell answers each line on stdin with one JSON sample.
// Spawning powershell.exe per sample costs seconds (start-up, plus Get-Counter
// expanding ~1100 GPU engine instances), so the 1 s cadence needs it kept warm.
// Rates (process CPU, GPU engine utilization) are deltas against the previous
// read, which is why the script reads once before it reports ready.
const READER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$cores = [Environment]::ProcessorCount
$cpuTotal = New-Object System.Diagnostics.PerformanceCounter 'Processor', '% Processor Time', '_Total'
$committed = New-Object System.Diagnostics.PerformanceCounter 'Memory', 'Committed Bytes'
$engineCategory = New-Object System.Diagnostics.PerformanceCounterCategory 'GPU Engine'
$memoryCategory = New-Object System.Diagnostics.PerformanceCounterCategory 'GPU Process Memory'
$prevBusy = @{}
$prevWall = 0
$prevEngine = @{}

# ConvertTo-Json in PS 5.1 writes NaN and Infinity bare, which is not JSON.
function Finite($value) {
  if ($null -eq $value -or [double]::IsNaN($value) -or [double]::IsInfinity($value)) { return $null }
  return $value
}

function Read-Sample {
  $sample = @{ procs = $null; engines = @(); gpuMem = @(); freeRam = $null; totalRam = $null; commit = $null; cpu = $null; gpu = $null }

  try {
    $wall = [DateTime]::UtcNow.Ticks
    $procs = New-Object System.Collections.ArrayList
    $busyNow = @{}
    foreach ($p in Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize, PrivatePageCount, KernelModeTime, UserModeTime) {
      $id = [int]$p.ProcessId
      $busy = [double]$p.KernelModeTime + [double]$p.UserModeTime
      $busyNow[$id] = $busy
      $cpu = $null
      if ($script:prevWall -gt 0 -and $script:prevBusy.ContainsKey($id) -and $wall -gt $script:prevWall) {
        $delta = $busy - $script:prevBusy[$id]
        if ($delta -ge 0) { $cpu = Finite ($delta / ($wall - $script:prevWall) * 100 / $cores) }
      }
      [void]$procs.Add(@($id, [int]$p.ParentProcessId, [string]$p.Name, [string]$p.CommandLine, [double]$p.WorkingSetSize, [double]$p.PrivatePageCount, $cpu))
    }
    $script:prevBusy = $busyNow
    $script:prevWall = $wall
    $sample.procs = $procs
  } catch { [Console]::Error.WriteLine("procs: $_") }

  try {
    $engines = New-Object System.Collections.ArrayList
    $engineNow = @{}
    $sum3d = 0
    foreach ($inst in $engineCategory.ReadCategory()['Utilization Percentage'].Values) {
      $raw = [double]$inst.RawValue
      $stamp = [double]$inst.Sample.TimeStamp100nSec
      $engineNow[$inst.InstanceName] = @($raw, $stamp)
      $prev = $script:prevEngine[$inst.InstanceName]
      if ($prev -and $stamp -gt $prev[1]) {
        $value = Finite (($raw - $prev[0]) / ($stamp - $prev[1]) * 100)
        if ($value -gt 0) {
          [void]$engines.Add(@($inst.InstanceName, $value))
          if ($inst.InstanceName -like '*_engtype_3D') { $sum3d += $value }
        }
      }
    }
    $script:prevEngine = $engineNow
    $sample.engines = $engines
    $sample.gpu = Finite ([Math]::Min(100, $sum3d))
  } catch { [Console]::Error.WriteLine("gpu engine: $_") }

  try {
    $mem = New-Object System.Collections.ArrayList
    foreach ($inst in $memoryCategory.ReadCategory()['Dedicated Usage'].Values) {
      if ($inst.RawValue -gt 0) { [void]$mem.Add(@($inst.InstanceName, [double]$inst.RawValue)) }
    }
    $sample.gpuMem = $mem
  } catch { [Console]::Error.WriteLine("gpu memory: $_") }

  try {
    $os = Get-CimInstance Win32_OperatingSystem -Property FreePhysicalMemory, TotalVisibleMemorySize
    $sample.freeRam = [double]$os.FreePhysicalMemory * 1024
    $sample.totalRam = [double]$os.TotalVisibleMemorySize * 1024
  } catch { [Console]::Error.WriteLine("os memory: $_") }

  try { $sample.commit = [double]$committed.RawValue } catch { [Console]::Error.WriteLine("commit: $_") }
  try { $sample.cpu = Finite ([double]$cpuTotal.NextValue()) } catch { [Console]::Error.WriteLine("cpu: $_") }

  ConvertTo-Json -InputObject $sample -Compress -Depth 4
}

[void](Read-Sample)
[Console]::Out.WriteLine('ready')
while ($null -ne [Console]::In.ReadLine()) {
  [Console]::Out.WriteLine((Read-Sample))
}
`;

function usage(message) {
  console.error(message);
  console.error(
    "usage: node scripts/measure-load.mjs --root <pid|auto> --scenario <S0..S5|label> --out <dir> [--seconds <n>] [--user-data <dir>]",
  );
  process.exit(2);
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      scenario: { type: "string" },
      out: { type: "string" },
      seconds: { type: "string" },
      "user-data": { type: "string" },
    },
  });
  if (!values.root || !values.scenario || !values.out) {
    usage("--root, --scenario and --out are required");
  }
  if (values.root === "auto" && !values["user-data"]) {
    usage("--root auto needs --user-data");
  }
  if (values.root !== "auto" && !/^\d+$/.test(values.root)) {
    usage("--root must be a pid or auto");
  }
  const seconds = values.seconds === undefined ? null : Number(values.seconds);
  if (seconds !== null && !(seconds > 0)) {
    usage("--seconds must be a positive number");
  }
  return {
    root: values.root,
    scenario: values.scenario,
    out: values.out,
    seconds,
    userData: values["user-data"],
  };
}

function startReader() {
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(READER_SCRIPT, "utf16le").toString("base64"),
    ],
    { stdio: ["pipe", "pipe", "inherit"], windowsHide: true },
  );
  const lines = createInterface({ input: child.stdout });
  let waiting = null;
  lines.on("line", (line) => {
    const resolve = waiting;
    waiting = null;
    resolve?.(line);
  });
  child.on("exit", (code) => {
    if (stopping) return;
    console.error(`PowerShell reader exited (${code})`);
    process.exit(1);
  });
  const nextLine = () => new Promise((resolve) => (waiting = resolve));
  return {
    ready: nextLine(),
    read: async () => {
      const line = nextLine();
      child.stdin.write("\n");
      return JSON.parse(await line);
    },
    stop: () => child.kill(),
  };
}

const normalisePath = (path) => path.replaceAll("/", "\\").toLowerCase();

function findAutoRoot(procs, userData) {
  const needle = normalisePath(userData);
  const match = procs.find(
    (p) =>
      p.name === "electron.exe" &&
      !p.cmd.includes("--type=") &&
      normalisePath(p.cmd).includes(needle),
  );
  return match ? match.pid : null;
}

const toProc = ([pid, ppid, name, cmd, ws, priv, cpu]) => ({
  pid,
  ppid,
  name,
  cmd,
  ws,
  priv,
  cpu,
});

function killTree(pid) {
  spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
    stdio: "ignore",
    windowsHide: true,
  });
}

const cli = parseCli();
const forceGuard = process.env.MEASURE_LOAD_FORCE_GUARD;
mkdirSync(cli.out, { recursive: true });
const procFile = join(cli.out, `${cli.scenario}.csv`);
const machineFile = join(cli.out, `${cli.scenario}.machine.csv`);
writeFileSync(procFile, toCsvLine(CSV_HEADER) + "\n");
writeFileSync(machineFile, toCsvLine(MACHINE_HEADER) + "\n");

const guard = makeGuard({ ramFloor: 0.1, ceiling: 95, holdSamples: 10 });
let rootPid = cli.root === "auto" ? null : Number(cli.root);
let killableRoots = null;
let stopping = false;
let busy = false;
let readStartedAt = 0;
let timer = null;
let endAt = Infinity;

const reader = startReader();

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  reader.stop();
  console.log(`wrote ${procFile} and ${machineFile}`);
  process.exit(exitCode);
}
process.on("SIGINT", () => stop(0));

function record(time, sample) {
  if (sample.procs === null) return;
  const fullProcs = sample.procs.map(toProc);
  if (rootPid === null) {
    rootPid = findAutoRoot(fullProcs, cli.userData);
    if (rootPid === null) {
      console.error(`no electron.exe main process found for ${cli.userData}`);
      stopping = true;
      reader.stop();
      process.exit(1);
    }
    console.log(`root pid ${rootPid}`);
  }
  // A vanished root's pid can be reused, and walking or killing that tree
  // would hit unrelated processes, so the run ends instead.
  if (!fullProcs.some((p) => p.pid === rootPid)) {
    console.error(`ROOT GONE ${rootPid}`);
    stop(2);
    return;
  }
  const procs = fullProcs.map((p) => ({ ...p, cmd: p.cmd.slice(0, CMD_MAX) }));
  const rows = buildRows(
    time,
    cli.scenario,
    procs,
    rootPid,
    gpuByPid(sample.engines),
    gpuByPid(sample.gpuMem),
  );
  if (rows.length > 0) {
    appendFileSync(procFile, rows.map(toCsvLine).join("\n") + "\n");
  }

  const roots = sessionRoots(procs, rootPid);
  if (killableRoots === null) {
    killableRoots = protectedRoots(roots);
    if (roots.length === 0) console.log("PROTECTED none");
    for (const pid of roots) {
      console.log(`PROTECTED ${pid} ${procs.find((p) => p.pid === pid).cmd}`);
    }
  }

  const { freeRam, totalRam, cpu, gpu } = sample;
  let guardCell = "";
  // A failed CPU or GPU read counts as 0, which resets only that metric's
  // streak, so the RAM check still runs.
  const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0);
  if (Number.isFinite(freeRam) && Number.isFinite(totalRam) && totalRam > 0) {
    const reason = guard({
      freeRamFrac: forceGuard === "ram" ? 0 : freeRam / totalRam,
      cpu: finiteOrZero(cpu),
      gpu: finiteOrZero(gpu),
    });
    if (reason !== null) {
      guardCell = `GUARD:${reason}`;
      killableRoots(roots).forEach(killTree);
      console.log(`GUARD ${reason}`);
    }
  }
  appendFileSync(
    machineFile,
    toCsvLine([
      time,
      cli.scenario,
      toMb(freeRam),
      toMb(totalRam),
      toMb(sample.commit),
      toPct(cpu),
      toPct(gpu),
      guardCell,
    ]) + "\n",
  );
}

// A read slower than TICK_MS makes the next tick find `busy` and skip, so
// samples land on the next free tick instead of queueing up. A read that
// outlives READ_DEADLINE_MS ends the run, since a stalled reader also means a
// silent guard.
async function tick() {
  if (stopping) return;
  if (Date.now() >= endAt) {
    stop(0);
    return;
  }
  if (busy) {
    if (Date.now() - readStartedAt > READ_DEADLINE_MS) {
      console.error(
        `reader gave no sample for ${READ_DEADLINE_MS / 1000} s; stopping`,
      );
      stop(1);
    }
    return;
  }
  busy = true;
  readStartedAt = Date.now();
  const time = new Date().toISOString();
  try {
    record(time, await reader.read());
  } catch (error) {
    console.error(`sample at ${time} skipped: ${error.message}`);
  } finally {
    busy = false;
  }
}

await reader.ready;
if (cli.seconds !== null) endAt = Date.now() + cli.seconds * 1000;
timer = setInterval(tick, TICK_MS);
tick();
