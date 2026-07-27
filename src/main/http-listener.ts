import http from "node:http";
import { mapHookEvent, type RawHookEvent } from "./event-mapper";
import { mapStatusEvent } from "./status-mapper";
import type { SendResult } from "./orchestrate";
import type { StatusEvent, ToolEvent, Workspace } from "../shared/types";

export const DEFAULT_PORT = 4599;

// structural, not the concrete Orchestrator — lets tests inject stubs
export interface OrchestratorLike {
  list(): unknown;
  send(target: string, prompt: string): SendResult;
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
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
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
    if (req.url === "/orchestrate/list" || req.url === "/orchestrate/send") {
      // ponytail: a browser can't set a custom header on a CORS simple request
      // without a preflight, and we never answer preflights — this alone keeps
      // web pages from writing into a live session (spec: trust boundary).
      if (req.headers["x-jarvis"] !== "1") {
        res.writeHead(403).end();
        return;
      }
      const isSend = req.url === "/orchestrate/send";
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (!isSend) {
          res.writeHead(200).end(JSON.stringify(orchestrator.list()));
          return;
        }
        let out: SendResult;
        try {
          const parsed = JSON.parse(body) as {
            workspace?: unknown;
            prompt?: unknown;
          };
          out = orchestrator.send(
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
