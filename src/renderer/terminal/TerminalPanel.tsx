import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import Inbox from "./Inbox";
import { renderNote } from "../preview/markdown";
import { relativeTime } from "../home/relative-time";
import type {
  StatusKind,
  Workspace,
  WorkspaceStatus,
} from "../../shared/types";

type Status =
  | { kind: "idle" }
  | { kind: "running"; hooksOk: boolean }
  | { kind: "exited"; code: number };

type Entry = { term: Terminal; fit: FitAddon; el: HTMLDivElement };

// same state colors the rail badges and inbox dots use — amber is "waiting"
const PILL: Record<StatusKind, string> = {
  waiting: "border-warm/30 bg-warm/10 text-warm",
  running: "border-accent/30 bg-accent/10 text-accent",
  idle: "border-ink-dim/30 bg-ink-dim/10 text-ink-dim",
  none: "border-ink-dim/30 bg-ink-dim/10 text-ink-dim",
};
const PILL_LABEL: Record<StatusKind, string> = {
  waiting: "waiting on you",
  running: "running",
  idle: "idle",
  none: "idle",
};
const BAR: Record<StatusKind, string> = {
  waiting: "from-warm",
  running: "from-accent",
  idle: "from-ink-dim",
  none: "from-ink-dim",
};

// Module-level so terminals (and their scrollback) survive workspace
// switches and panel collapse/expand — the component only attaches them.
const entries = new Map<string, Entry>();
const exitListeners = new Set<(id: string, code: number) => void>();
let subscribed = false;

// module-scope and permanent by design: these feed terminals that outlive
// any one mount, so the disposers are deliberately dropped
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

export default function TerminalPanel({
  workspace,
  inbox,
}: {
  workspace: Workspace;
  // the inbox is the fleet view — home only. A workspace's terminal is just
  // its own, so there is nothing there for a cross-workspace list to do.
  inbox?: { workspaces: Workspace[]; statuses: WorkspaceStatus[] };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, Status>>(
    {},
  );
  const [width, setWidth] = useState(480);
  const [collapsed, setCollapsed] = useState(true);
  // a permission-free session is the one action here with no undo, so it costs
  // two clicks and the second one says what it does
  const [armed, setArmed] = useState(false);
  const status: Status = localStatuses[workspace.id] ?? { kind: "idle" };
  // the reindex command comes from the workspace's own graph source — the
  // panel never names gitnexus, so a graphify workspace gets `/graphify .`
  const [reindexCommand, setReindexCommand] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setReindexCommand(null);
    window.jarvis
      .staleReindexCommand(workspace.id)
      .then((cmd) => !cancelled && setReindexCommand(cmd));
    return () => {
      cancelled = true;
    };
  }, [workspace.id]);

  const detailWs = inbox?.workspaces.find((w) => w.id === detailId);
  const detailStatus = inbox?.statuses.find((s) => s.workspaceId === detailId);
  const detail =
    detailWs && detailStatus ? { ws: detailWs, status: detailStatus } : null;

  // Claude's last message is markdown — run it through the same pipeline the
  // preview uses so bold/tables/lists read the same here. No vault to link
  // into, so both link deps are dead ends.
  const [detailHtml, setDetailHtml] = useState("");
  const message = detail?.status.message ?? "";
  useEffect(() => {
    let stale = false;
    if (!message) {
      setDetailHtml("");
      return;
    }
    renderNote(message, {
      resolveLink: () => null,
      loadNote: async () => null,
    }).then((html) => !stale && setDetailHtml(html));
    return () => {
      stale = true;
    };
  }, [message]);

  useEffect(() => {
    ensureSubscribed();
    const onExit = (id: string, code: number) =>
      setLocalStatuses((m) => ({ ...m, [id]: { kind: "exited", code } }));
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

  const launch = (dangerous = false) => {
    const e = entryFor(workspace.id);
    e.fit.fit();
    window.jarvis
      .ptyLaunch(workspace.id, e.term.cols, e.term.rows, dangerous)
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
        setLocalStatuses((m) => ({
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
        {reindexCommand && status.kind === "running" && (
          <button
            className="cursor-pointer text-amber-400 hover:text-amber-300"
            title={`Graph is behind HEAD — type \`${reindexCommand}\``}
            onClick={() => window.jarvis.ptyInput(workspace.id, reindexCommand)}
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

      {inbox && (
        <div
          className="max-h-[45%] min-h-0 flex-none border-b border-edge"
          data-testid="terminal-inbox"
        >
          <Inbox
            workspaces={inbox.workspaces}
            statuses={inbox.statuses}
            activeId={detailId}
            onSelect={(ws) =>
              setDetailId((id) => (id === ws.id ? null : ws.id))
            }
          />
        </div>
      )}
      {detail && (
        // inset from the terminal's left edge, floating over the graph
        <div
          className="absolute top-11 right-[calc(100%+20px)] bottom-5 z-10 flex w-[340px] flex-col rounded-xl border border-edge bg-gradient-to-b from-panel/95 to-abyss/95 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.8),0_0_0_1px_rgba(34,211,238,0.06)] backdrop-blur-[2px]"
          data-testid="inbox-detail"
        >
          {/* state bar: the panel says which state it is before you read it */}
          <span
            className={`absolute top-3.5 bottom-3.5 -left-px w-0.5 rounded-full bg-gradient-to-b to-transparent ${BAR[detail.status.kind]}`}
          />
          <div className="flex items-center gap-2.5 border-b border-edge px-4 pt-3 pb-2.5">
            <span className="truncate font-semibold text-ink">
              {detail.ws.name}
            </span>
            <span
              className={`flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.1em] uppercase ${PILL[detail.status.kind]}`}
            >
              {PILL_LABEL[detail.status.kind]}
            </span>
            <span className="ml-auto flex-none text-[12px] text-ink-dim tabular-nums">
              {relativeTime(detail.status.since, Date.now())}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {message ? (
              <>
                <div className="mb-2.5 text-[11px] tracking-[0.16em] text-accent uppercase">
                  Claude said
                </div>
                <div
                  className="preview-body font-sans text-sm leading-relaxed text-ink"
                  dangerouslySetInnerHTML={{ __html: detailHtml }}
                />
              </>
            ) : (
              // a session that has only just launched has neither call nor
              // message — say so, so an empty panel doesn't read as a broken one
              <div className="font-mono text-sm break-words text-ink-dim">
                {detail.status.call || "nothing yet this session"}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="h-full w-full" />
        {status.kind !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel/80">
            <button
              className="cursor-pointer rounded-md border border-edge px-4 py-2 text-[13px] text-ink-dim hover:border-accent hover:text-accent"
              onClick={() => launch()}
            >
              {status.kind === "exited" ? "Relaunch Claude" : "Launch Claude"}
            </button>
            <button
              className="cursor-pointer rounded-md border border-amber-500/40 px-4 py-2 text-[13px] text-amber-400 hover:border-amber-400 hover:text-amber-300"
              title="claude --dangerously-skip-permissions"
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                setArmed(false);
                launch(true);
              }}
            >
              {armed
                ? "Click again — edits and shell run unprompted"
                : "Launch without permission prompts"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
