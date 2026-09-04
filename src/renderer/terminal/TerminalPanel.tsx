import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import Inbox from "./Inbox";
import { renderNote } from "../preview/markdown";
import { relativeTime } from "../home/relative-time";
import { LBL_AM } from "../ui/hud";
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
/**
 * Where the inbox detail sits, given the terminal panel's rect, the box's own
 * width and the viewport height. Pure, so the clamps are testable without a
 * DOM. The panel's height is deliberately not an input: collapsed, it
 * shrink-wraps to the inbox strip, and the message still needs room to read.
 */
export function detailBox(
  panel: { left: number; right: number; top: number },
  width: number,
  viewportH: number,
) {
  const gap = 20;
  const min = 340; // shortest box worth opening
  const top = Math.max(gap, Math.min(panel.top, viewportH - min));
  return {
    // flip to the panel's right when there is no room on its left
    left:
      panel.left > width + gap * 2
        ? panel.left - width - gap
        : panel.right + gap,
    top,
    maxHeight: viewportH - top - gap,
  };
}

const MODELS = [
  { value: "fable", label: "Fable" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

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
  live,
  inbox,
  inboxOnly,
  visible,
}: {
  workspace: Workspace;
  // main spawns the main agent's pty at boot, so this panel never saw that
  // launch. WorkspaceStatus.live is the renderer's only record of it — without
  // it the launch overlay covers a session that is already running.
  live?: boolean;
  // the inbox is the fleet view — home only. A workspace's terminal is just
  // its own, so there is nothing there for a cross-workspace list to do.
  inbox?: { workspaces: Workspace[]; statuses: WorkspaceStatus[] };
  // the collapsed home panel: the fleet's state stays, the session goes away
  inboxOnly?: boolean;
  // Whether the panel around this is on screen yet. The boot sequence holds it
  // closed with `visibility: hidden`, and nothing inside a hidden subtree can
  // take focus — so the focus call waits for this rather than firing at mount
  // into a no-op and never running again. Absent means visible.
  visible?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, Status>>(
    {},
  );
  // a permission-free session is the one action here with no undo, so it costs
  // two clicks and the second one says what it does
  const [armed, setArmed] = useState(false);
  // Nothing is persisted: the picker returns to Opus on every mount,
  // including a relaunch after an exit, so a one-off Haiku session doesn't
  // silently become the next one too.
  const [model, setModel] = useState("opus");
  // an exit reaches localStatuses through the pty-exit listener, so a launch
  // this panel did not make still ends here rather than staying "running"
  const status: Status =
    localStatuses[workspace.id] ??
    (live ? { kind: "running", hooksOk: true } : { kind: "idle" });
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

  // Park the detail alongside the panel. Written to the element rather than to
  // state: this runs on every render (a panel drag re-renders App, hence us)
  // and a setState here would loop.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const el = detailRef.current;
    if (!root || !el) return;
    // its own width is a class, not a constant here — read it back
    const box = detailBox(
      root.getBoundingClientRect(),
      el.offsetWidth,
      window.innerHeight,
    );
    el.style.left = `${box.left}px`;
    el.style.top = `${box.top}px`;
    el.style.maxHeight = `${box.maxHeight}px`;
  });

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
  // pty's cols/rows in step with it. One ResizeObserver covers all the ways
  // the element can change size — window resize, panel drag/resize.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const e = entryFor(workspace.id);
    host.replaceChildren(e.el);
    const refit = () => {
      e.fit.fit();
      window.jarvis.ptyResize(workspace.id, e.term.cols, e.term.rows);
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(host);
    return () => observer.disconnect();
  }, [workspace.id]);

  // Separate from the mount effect above, and keyed on visibility: the boot
  // sequence holds this panel behind `visibility: hidden` until its stage, and
  // a focus call inside a hidden subtree is a silent no-op.
  useEffect(() => {
    if (visible === false) return;
    entryFor(workspace.id).term.focus();
  }, [workspace.id, visible]);

  const launch = (dangerous = false) => {
    const e = entryFor(workspace.id);
    e.fit.fit();
    window.jarvis
      .ptyLaunch(workspace.id, e.term.cols, e.term.rows, dangerous, model)
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

  return (
    // inbox-only sizes to its rows, so it must not claim the panel's height
    <div
      ref={rootRef}
      className={"relative flex flex-col " + (inboxOnly ? "" : "h-full")}
    >
      {inbox && (
        <div
          className={
            "min-h-0 " +
            (inboxOnly ? "" : "max-h-[45%] flex-none border-b border-edge")
          }
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
        // Sits beside the panel, floating over the graph. Panel's body clips
        // its children (overflow-hidden), so an absolute box placed outside the
        // panel renders to nothing — fixed escapes the clip (no ancestor sets a
        // transform) and the layout effect above puts it back alongside.
        <div
          ref={detailRef}
          className="fixed z-30 flex w-[340px] flex-col overflow-hidden rounded-xl border border-edge bg-gradient-to-b from-panel/95 to-abyss/95 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.8),0_0_0_1px_rgba(34,211,238,0.06)] backdrop-blur-[2px]"
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
      <div
        className="relative min-h-0 flex-1"
        data-testid="terminal-body"
        hidden={inboxOnly}
      >
        {reindexCommand && status.kind === "running" && (
          <button
            className={LBL_AM + " absolute top-1 right-2 z-10 cursor-pointer"}
            title={`Graph is behind HEAD — type \`${reindexCommand}\``}
            onClick={() => window.jarvis.ptyInput(workspace.id, reindexCommand)}
          >
            index stale
          </button>
        )}
        <div ref={hostRef} className="h-full w-full" />
        {status.kind !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel/80">
            <div className="flex gap-1.5" data-testid="launch-model">
              {MODELS.map(({ value, label }) => (
                <button
                  key={value}
                  className={
                    "cursor-pointer rounded-md border px-2.5 py-1 text-[13px] " +
                    (model === value
                      ? "border-accent text-accent"
                      : "border-edge text-ink-dim hover:border-accent hover:text-accent")
                  }
                  onClick={() => setModel(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="cursor-pointer rounded-md border border-edge px-4 py-2 text-[13px] text-ink-dim hover:border-accent hover:text-accent"
              onClick={() => launch()}
            >
              {status.kind === "exited"
                ? `Relaunch Claude — exited (${status.code})`
                : "Launch Claude"}
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
