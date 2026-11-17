import http from "node:http";
import { mapHookEvent, type RawHookEvent } from "./event-mapper";
import { mapStatusEvent } from "./status-mapper";
import { mapAskEvent, type AskPrompt } from "./ask-mapper";
import { mapTextQuestion } from "./text-question-mapper";
import { mapSessionStart, type SessionStart } from "./session-start";
import type {
  CloseResult,
  DeliveredResult,
  LaunchResult,
  SendOptions,
  SendResult,
} from "./orchestrate";
import type {
  AgentId,
  StatusEvent,
  ToolEvent,
  Workspace,
} from "../shared/types";
import { agentById } from "./agents";

export const DEFAULT_PORT = 4599;

// ponytail: hook payloads are a few KB; the cap only exists so an unauthenticated
// POST can't grow main's memory. Raise it if a real tool_response ever trips it.
const MAX_BODY = 1 << 20; // 1 MiB

const ORCHESTRATE = [
  "/orchestrate/list",
  "/orchestrate/send",
  "/orchestrate/launch",
  "/orchestrate/trust",
  "/orchestrate/close",
  "/orchestrate/watch",
  "/orchestrate/say",
  "/orchestrate/todos",
];

const optionalString = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

// only the literal "codex" picks another agent; anything else means Claude
const optionalAgent = (v: unknown): "codex" | undefined =>
  v === "codex" ? v : undefined;

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

export interface MapperSinks {
  onEvent(e: ToolEvent): void;
  onStatus(e: StatusEvent): void;
  onAsk?(p: AskPrompt): void;
  onSessionStart?(s: SessionStart): void;
  getWorkspaces(): Workspace[];
}

/** Runs every mapper on one Claude-shaped payload. `offered` marks a question
 * the reply already answered; `askPanel` false skips the text-question panel. */
export function runMappers(
  raw: RawHookEvent,
  sinks: MapperSinks,
  opts: { askPanel: boolean; offered: boolean },
): void {
  const ws = sinks.getWorkspaces();
  // the two mappers are independent: one rejecting must not affect the
  // other, so they get a try each rather than sharing one
  try {
    const e = mapHookEvent(raw, ws);
    if (e) sinks.onEvent(e);
  } catch {
    /* highlight mapping failed — status may still be fine */
  }
  // the reply is an offer Claude Code may not take, so every event still maps
  try {
    const s = mapStatusEvent(raw, ws);
    if (s) sinks.onStatus(s);
  } catch {
    /* status mapping failed — highlights already went out */
  }
  // independent mappers, a try block each: one rejecting must never
  // take another's output with it
  try {
    const a = mapAskEvent(raw, ws);
    // undefined = not about questions; no questions = that one is over
    if (a !== undefined)
      sinks.onAsk?.(
        opts.offered && a.questions.length > 0 ? { ...a, offered: true } : a,
      );
  } catch {
    /* ask mapping failed — highlights and status already went out */
  }
  if (opts.askPanel) {
    try {
      const t = mapTextQuestion(raw, ws);
      if (t) sinks.onAsk?.(t);
    } catch {
      /* text question mapping failed — the other mappers already ran */
    }
  }
  try {
    const started = mapSessionStart(raw, ws);
    if (started) sinks.onSessionStart?.(started);
  } catch {
    /* a missed switch is caught up by the session's next hook */
  }
}

// structural, not the concrete Orchestrator — lets tests inject stubs
export interface OrchestratorLike {
  list(): unknown;
  send(
    target: string,
    prompt: string,
    opts?: SendOptions,
  ): Promise<DeliveredResult>;
  watch(timeoutSeconds?: number, signal?: AbortSignal): Promise<unknown>;
  say(text: string): SendResult;
  launch(
    target: string,
    label?: string,
    resume?: boolean,
    agent?: AgentId,
  ): Promise<LaunchResult>;
  trust(target: string, accept: boolean, session?: string): Promise<SendResult>;
  /** Ends the named session; refuses one whose turn is in flight. */
  close(target: string, session: string): Promise<CloseResult>;
  /** Opens the to-do panel and answers the list file for the agent to edit. */
  todos(): Promise<unknown>;
}

export function startListener(
  port: number,
  onEvent: (e: ToolEvent) => void,
  onStatus: (e: StatusEvent) => void,
  getWorkspaces: () => Workspace[],
  orchestrator: OrchestratorLike,
  // optional so existing callers and tests keep compiling; a build without a
  // renderer simply drops questions on the floor
  onAsk?: (p: AskPrompt) => void,
  onStatusLine?: (sessionKey: string, raw: Record<string, unknown>) => void,
  onSessionStart?: (s: SessionStart) => void,
  // the hook output to print for this event, or null to leave the prompt to
  // the user; the reply to /event carries it back to forward.mjs
  autoAnswer?: (raw: RawHookEvent) => unknown | null,
  onHook?: (sessionKey: string, hookEventName: string) => void,
): http.Server {
  const sinks: MapperSinks = {
    onEvent,
    onStatus,
    onAsk,
    onSessionStart,
    getWorkspaces,
  };
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
      // rendered as HTML, so the body must not be page-writable. The reply body
      // is printed by forward.mjs as the hook output, so it must not be
      // page-writable either.
      if (
        !String(req.headers["content-type"] ?? "").startsWith(
          "application/json",
        )
      ) {
        res.writeHead(415).end();
        return;
      }
      readBody(req, (body) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(200).end(); // malformed hook payload → ack and ignore
          return;
        }
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          res.writeHead(200).end();
          return;
        }
        const raw = parsed as RawHookEvent & Record<string, unknown>;
        const agent = agentById(raw.jarvis_agent);
        try {
          const gate = agent.gateEvent?.(raw) ?? raw.hook_event_name;
          if (
            typeof raw.jarvis_session === "string" &&
            typeof gate === "string"
          )
            onHook?.(raw.jarvis_session, gate);
        } catch {
          /* the gate is best effort; mapping still runs */
        }
        // the answer is computed synchronously and the mappers run after the
        // reply, so the agent waits for nothing but the callback. Only Claude
        // reads the reply as hook output.
        let answer: unknown = null;
        if (agent.id === "claude") {
          try {
            answer = autoAnswer?.(raw) ?? null;
          } catch {
            /* a failing answerer leaves the prompt to the user */
          }
        }
        if (answer === null) res.writeHead(200).end();
        else res.writeHead(200).end(JSON.stringify(answer));
        const mapBody = (body: Record<string, unknown>): void => {
          let payloads: RawHookEvent[];
          try {
            payloads = agent.normalize(body);
          } catch {
            return; // a payload the adapter cannot read maps nothing
          }
          for (const p of payloads)
            runMappers(p, sinks, {
              askPanel: agent.features.askPanel,
              offered: answer !== null,
            });
        };
        const enrich = agent.enrich?.bind(agent);
        // an adapter with no enrich maps in this same tick
        if (!enrich) {
          mapBody(raw);
          return;
        }
        void (async () => {
          let body: Record<string, unknown> = raw;
          try {
            body = await enrich(raw);
          } catch {
            /* a failing enrich maps the body as it arrived */
          }
          mapBody(body);
        })();
      });
      return;
    }
    if (req.url === "/statusline") {
      // same trust rules as /event: JSON-only forces a preflight we never answer
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
        try {
          const raw = JSON.parse(body) as Record<string, unknown>;
          const key = raw.jarvis_session;
          if (typeof key === "string" && key) onStatusLine?.(key, raw);
        } catch {
          /* malformed body or failing handler — the status line is best effort */
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
        const fail = (err: unknown) => {
          if (res.writableEnded || res.destroyed) return;
          res.writeHead(500).end(JSON.stringify({ error: String(err) }));
        };
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
            // a client that hangs up while parked releases the waiter, or the
            // next finish resolves into a dead socket and nobody ever reads it
            const ctl = new AbortController();
            req.on("close", () => ctl.abort());
            orchestrator
              .watch(secs, ctl.signal)
              .then((out) => {
                if (res.writableEnded || res.destroyed) return;
                const json = JSON.stringify(out); // before writeHead
                res.writeHead(200).end(json);
              })
              .catch(fail);
          } catch (err) {
            fail(err);
          }
          return;
        }
        if (route === "/orchestrate/launch") {
          let target: string;
          let label: string | undefined;
          let resume: boolean;
          let agent: AgentId | undefined;
          try {
            const p = parse();
            target = String(p.workspace ?? "");
            label = optionalString(p.label);
            resume = p.resume === true;
            agent = optionalAgent(p.agent);
          } catch (err) {
            const out = {
              ok: false,
              error: `malformed request: ${String(err)}`,
            };
            res.writeHead(200).end(JSON.stringify(out));
            return;
          }
          orchestrator
            .launch(target, label, resume, agent)
            .then((out) => {
              if (res.writableEnded || res.destroyed) return;
              res.writeHead(200).end(JSON.stringify(out));
            })
            .catch(fail);
          return;
        }
        if (route === "/orchestrate/trust") {
          let target: string;
          let accept: boolean;
          let session: string | undefined;
          try {
            const p = parse();
            target = String(p.workspace ?? "");
            // only a literal true trusts a folder; anything else declines
            accept = p.accept === true;
            session = optionalString(p.session);
          } catch (err) {
            const out = {
              ok: false,
              error: `malformed request: ${String(err)}`,
            };
            res.writeHead(200).end(JSON.stringify(out));
            return;
          }
          orchestrator
            .trust(target, accept, session)
            .then((out) => {
              if (res.writableEnded || res.destroyed) return;
              res.writeHead(200).end(JSON.stringify(out));
            })
            .catch(fail);
          return;
        }
        if (route === "/orchestrate/close") {
          let target: string;
          let session: string;
          try {
            const p = parse();
            target = String(p.workspace ?? "");
            session = String(p.session ?? "");
          } catch (err) {
            const out = {
              ok: false,
              error: `malformed request: ${String(err)}`,
            };
            res.writeHead(200).end(JSON.stringify(out));
            return;
          }
          orchestrator
            .close(target, session)
            .then((out) => {
              if (res.writableEnded || res.destroyed) return;
              res.writeHead(200).end(JSON.stringify(out));
            })
            .catch(fail);
          return;
        }
        if (route === "/orchestrate/todos") {
          try {
            orchestrator
              .todos()
              .then((out) => {
                if (res.writableEnded || res.destroyed) return;
                const json = JSON.stringify(out); // before writeHead
                res.writeHead(200).end(json);
              })
              .catch(fail);
          } catch (err) {
            fail(err);
          }
          return;
        }
        if (route === "/orchestrate/send") {
          let target: string;
          let prompt: string;
          let opts: SendOptions;
          try {
            const p = parse();
            target = String(p.workspace ?? "");
            prompt = String(p.prompt ?? "");
            // only a literal true opens a new session, like trust's accept
            opts = {
              session: optionalString(p.session),
              fresh: p.fresh === true,
              label: optionalString(p.label),
            };
            const agent = optionalAgent(p.agent);
            if (agent) opts.agent = agent;
          } catch (err) {
            const out = {
              ok: false,
              error: `malformed request: ${String(err)}`,
            };
            res.writeHead(200).end(JSON.stringify(out));
            return;
          }
          orchestrator
            .send(target, prompt, opts)
            .then((out) => {
              if (res.writableEnded || res.destroyed) return;
              res.writeHead(200).end(JSON.stringify(out));
            })
            .catch(fail);
          return;
        }
        let out: SendResult;
        try {
          out = orchestrator.say(String(parse().text ?? ""));
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
