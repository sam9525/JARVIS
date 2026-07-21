import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { Workspace } from "../shared/types";

type Status =
  | { kind: "idle" }
  | { kind: "running"; hooksOk: boolean }
  | { kind: "exited"; code: number };

type Entry = { term: Terminal; fit: FitAddon; el: HTMLDivElement };

// Module-level so terminals (and their scrollback) survive workspace
// switches and panel collapse/expand — the component only attaches them.
const entries = new Map<string, Entry>();
const exitListeners = new Set<(id: string, code: number) => void>();
let subscribed = false;

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  window.jarvis.onPtyData((id, data) => entries.get(id)?.term.write(data));
  window.jarvis.onPtyExit((id, code) => {
    for (const l of exitListeners) l(id, code);
  });
}

function entryFor(id: string): Entry {
  let e = entries.get(id);
  if (!e) {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "Consolas, monospace",
      theme: { background: "#02060b" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const el = document.createElement("div");
    el.style.width = "100%";
    el.style.height = "100%";
    term.open(el);
    term.onData((d) => window.jarvis.ptyInput(id, d));
    e = { term, fit, el };
    entries.set(id, e);
  }
  return e;
}

export default function TerminalPanel({ workspace }: { workspace: Workspace }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [width, setWidth] = useState(480);
  const [collapsed, setCollapsed] = useState(true);
  const status: Status = statuses[workspace.id] ?? { kind: "idle" };

  useEffect(() => {
    ensureSubscribed();
    const onExit = (id: string, code: number) =>
      setStatuses((m) => ({ ...m, [id]: { kind: "exited", code } }));
    exitListeners.add(onExit);
    return () => {
      exitListeners.delete(onExit);
    };
  }, []);

  // Attach the active workspace's terminal element to the panel and keep the
  // pty's cols/rows in step with it. One ResizeObserver covers all three ways
  // the element can change size — window resize, splitter drag, collapse —
  // which is why `width` is deliberately not a dependency here.
  useEffect(() => {
    if (collapsed) return;
    const host = hostRef.current;
    if (!host) return;
    const e = entryFor(workspace.id);
    host.replaceChildren(e.el);
    const refit = () => {
      e.fit.fit();
      window.jarvis.ptyResize(workspace.id, e.term.cols, e.term.rows);
    };
    refit();
    e.term.focus();
    const observer = new ResizeObserver(refit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [workspace.id, collapsed]);

  const launch = () => {
    const e = entryFor(workspace.id);
    e.fit.fit();
    window.jarvis
      .ptyLaunch(workspace.id, e.term.cols, e.term.rows)
      .then(({ ok, hooksOk }) => {
        if (!ok) {
          e.term.writeln(
            "\x1b[31m[jarvis] could not start a terminal — is the claude CLI on PATH?\x1b[0m",
          );
          return;
        }
        if (!hooksOk)
          e.term.writeln(
            "\x1b[33m[jarvis] .claude/settings.local.json unparseable — hooks not installed; the graph won't highlight\x1b[0m",
          );
        setStatuses((m) => ({
          ...m,
          [workspace.id]: { kind: "running", hooksOk },
        }));
      })
      .catch((err) => {
        // spawn failure — most likely the claude CLI isn't installed/on PATH
        e.term.writeln(`\x1b[31m[jarvis] launch failed: ${err}\x1b[0m`);
      });
  };

  const startDrag = (ev: React.MouseEvent) => {
    ev.preventDefault();
    const startX = ev.clientX;
    const startW = width;
    const move = (m: MouseEvent) =>
      setWidth(
        Math.min(
          Math.max(startW + (startX - m.clientX), 300),
          window.innerWidth - 240,
        ),
      );
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (collapsed) {
    return (
      <button
        className="fixed top-1/2 right-0 z-10 cursor-pointer rounded-l-md border border-edge bg-panel px-1 py-3 text-[11px] text-ink-dim hover:text-accent"
        title="Open terminal"
        onClick={() => setCollapsed(false)}
      >
        {">_"}
      </button>
    );
  }

  return (
    <div
      className="relative flex flex-none flex-col border-l border-edge bg-panel"
      style={{ width }}
    >
      <div
        className="absolute top-0 bottom-0 left-0 w-1 cursor-col-resize"
        onMouseDown={startDrag}
      />
      <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5 text-[12px] text-ink-dim">
        <span className="flex-1 truncate">
          {workspace.name}
          {status.kind === "exited" ? ` — exited (${status.code})` : ""}
        </span>
        {workspace.staleIndex && status.kind === "running" && (
          <button
            className="cursor-pointer text-amber-400 hover:text-amber-300"
            title="GitNexus index is behind HEAD — type the reindex command"
            onClick={() =>
              window.jarvis.ptyInput(workspace.id, "npx gitnexus analyze")
            }
          >
            index stale
          </button>
        )}
        <button
          className="cursor-pointer hover:text-accent"
          title="Collapse"
          onClick={() => setCollapsed(true)}
        >
          »
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="h-full w-full" />
        {status.kind !== "running" && (
          <div className="absolute inset-0 flex items-center justify-center bg-panel/80">
            <button
              className="cursor-pointer rounded-md border border-edge px-4 py-2 text-[13px] text-ink-dim hover:border-accent hover:text-accent"
              onClick={launch}
            >
              {status.kind === "exited" ? "Relaunch Claude" : "Launch Claude"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
