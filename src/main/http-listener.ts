import http from "node:http";
import { mapHookEvent, type RawHookEvent } from "./event-mapper";
import { mapStatusEvent } from "./status-mapper";
import type { StatusEvent, ToolEvent, Workspace } from "../shared/types";

export const DEFAULT_PORT = 4599;

export function startListener(
  port: number,
  onEvent: (e: ToolEvent) => void,
  onStatus: (e: StatusEvent) => void,
  getWorkspaces: () => Workspace[],
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/event") {
      res.writeHead(404).end();
      return;
    }
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
  });
  server.on("error", (err) => {
    console.error("HTTP listener error:", err);
  });
  server.listen(port, "127.0.0.1"); // localhost only, never exposed
  return server;
}
