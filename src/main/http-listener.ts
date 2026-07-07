import http from "node:http";
import { mapHookEvent, type RawHookEvent } from "./event-mapper";
import type { ToolEvent } from "../shared/types";

export const DEFAULT_PORT = 4599;

export function startListener(
  port: number,
  onEvent: (e: ToolEvent) => void,
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
      try {
        const event = mapHookEvent(JSON.parse(body) as RawHookEvent);
        if (event) onEvent(event);
      } catch {
        // malformed hook payload → ignore
      }
    });
  });
  server.on("error", (err) => {
    console.error("HTTP listener error:", err);
  });
  server.listen(port, "127.0.0.1"); // localhost only, never exposed
  return server;
}
