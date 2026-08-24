import http from "node:http";
import { mapHookEvent, type RawHookEvent } from "./event-mapper";
import { mapStatusEvent } from "./status-mapper";
import type { SendResult } from "./orchestrate";
import type { StatusEvent, ToolEvent, Workspace } from "../shared/types";

export const DEFAULT_PORT = 4599;

// ponytail: hook payloads are a few KB; the cap only exists so an unauthenticated
// POST can't grow main's memory. Raise it if a real tool_response ever trips it.
const MAX_BODY = 1 << 20; // 1 MiB

const ORCHESTRATE = [
  "/orchestrate/list",
  "/orchestrate/send",
  "/orchestrate/watch",
  "/orchestrate/say",
];

// Over the cap we destroy the socket, so "end" never fires and done() never runs.
function readBody(
  req: http.IncomingMessage,
  done: (body: string) => void,
): void {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY) {
      body = "";
      req.destroy();
    }
  });
  req.on("end", () => done(body));
}

// structural, not the concrete Orchestrator — lets tests inject stubs
export interface OrchestratorLike {
  list(): unknown;
  send(target: string, prompt: string): SendResult;
  watch(timeoutSeconds?: number): Promise<unknown>;
  say(text: string): SendResult;
}

export function startListener(
  port: number,
  onEvent: (e: ToolEvent) => void,
  onStatus: (e: StatusEvent) => void,
  getWorkspaces: () => Workspace[],
  orchestrator: OrchestratorLike,
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end(); // includes OPTIONS: we never answer preflights
      return;
    }
    if (req.url === "/event") {
      // /event stays open on purpose (any Claude Code session may post to it),
      // but application/json is outside the CORS simple-request set — so a web
      // page has to preflight, and we never answer preflights. forward.mjs
      // already sends this header; the Stop message it carries is persisted and
      // rendered as HTML, so the body must not be page-writable.
      if (
        !String(req.headers["content-type"] ?? "").startsWith(
          "application/json",
        )
      ) {
        res.writeHead(415).end();
        return;
      }
      readBody(req, (body) => {
        res.writeHead(200).end(); // ack immediately — never make Claude Code wait
        let raw: RawHookEvent;
        try {
          raw = JSON.parse(body) as RawHookEvent;
        } catch {
          return; // malformed hook payload → ignore
        }
        const ws = getWorkspaces();
        // the two mappers are independent: one rejecting must not affect the
        // other, so they get a try each rather than sharing one
        try {
          const e = mapHookEvent(raw, ws);
          if (e) onEvent(e);
        } catch {
          /* highlight mapping failed — status may still be fine */
        }
        try {
          const s = mapStatusEvent(raw, ws);
          if (s) onStatus(s);
        } catch {
          /* status mapping failed — highlights already went out */
        }
      });
      return;
    }
    if (ORCHESTRATE.includes(req.url ?? "")) {
      // ponytail: a browser can't set a custom header on a CORS simple request
      // without a preflight, and we never answer preflights — this alone keeps
      // web pages from writing into a live session (spec: trust boundary).
      if (req.headers["x-jarvis"] !== "1") {
        res.writeHead(403).end();
        return;
      }
      const route = req.url ?? "";
      readBody(req, (body) => {
        res.setHeader("content-type", "application/json");
        // a throw inside an http handler is uncaught, and in Electron main
        // that kills the process — every branch below gets a try
        const fail = (err: unknown) =>
          res.writeHead(500).end(JSON.stringify({ error: String(err) }));
        const parse = (): Record<string, unknown> => {
          const p: unknown = JSON.parse(body || "{}");
          return typeof p === "object" && p !== null
            ? (p as Record<string, unknown>)
            : {};
        };
        if (route === "/orchestrate/list") {
          try {
            const json = JSON.stringify(orchestrator.list()); // before writeHead
            res.writeHead(200).end(json);
          } catch (err) {
            fail(err);
          }
          return;
        }
        if (route === "/orchestrate/watch") {
          let secs: number | undefined;
          try {
            const raw = parse().timeout_seconds;
            const n = Number(raw);
            // Number(null) is 0, not NaN — an explicit null must read as
            // "no timeout given" the same as an absent field, not as zero
            secs = raw != null && Number.isFinite(n) ? n : undefined;
          } catch {
            secs = undefined; // malformed body → the default timeout
          }
          try {
            orchestrator
              .watch(secs)
              .then((out) => {
                const json = JSON.stringify(out); // before writeHead
                res.writeHead(200).end(json);
              })
              .catch(fail);
          } catch (err) {
            fail(err);
          }
          return;
        }
        let out: SendResult;
        try {
          const parsed = parse();
          out =
            route === "/orchestrate/say"
              ? orchestrator.say(String(parsed.text ?? ""))
              : orchestrator.send(
                  String(parsed.workspace ?? ""),
                  String(parsed.prompt ?? ""),
                );
        } catch (err) {
          out = { ok: false, error: `malformed request: ${String(err)}` };
        }
        res.writeHead(200).end(JSON.stringify(out));
      });
      return;
    }
    res.writeHead(404).end();
  });
  server.on("error", (err) => {
    console.error("HTTP listener error:", err);
  });
  server.listen(port, "127.0.0.1"); // localhost only, never exposed
  return server;
}
