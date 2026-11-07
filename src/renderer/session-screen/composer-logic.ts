import type { SlashCommand } from "../../main/slash-commands";

export const FLIP_COMMANDS: readonly string[] = [
  "/config",
  "/permissions",
  "/mcp",
  "/agents",
  "/hooks",
  "/memory",
  "/plugin",
  "/login",
  "/logout",
  "/doctor",
  "/status",
  "/ide",
  "/terminal-setup",
  "/vim",
  "/theme",
  "/export",
];

/** Commands that run as typed on an exact Enter; they never appear in the slash list. */
export const BUILT_IN_COMMANDS: readonly string[] = [
  ...new Set([
    ...FLIP_COMMANDS,
    "/add-dir",
    "/agents",
    "/clear",
    "/compact",
    "/context",
    "/cost",
    "/help",
    "/init",
    "/model",
    "/plan",
    "/resume",
    "/review",
    "/skills",
    "/usage",
  ]),
];

export const BOX_MIN_PX = 54;
export const BOX_KEY_STEP_PX = 20;

/** Container query units: 60% of the panel, less 130px for the status lines. */
export const BOX_CAP = "min(60cqh, calc(100cqh - 130px))";

export function dragMinHeight(startHeight: number, draggedUp: number): string {
  return `min(${Math.max(BOX_MIN_PX, startHeight + draggedUp)}px, ${BOX_CAP})`;
}

export const MODELS: readonly {
  value: string;
  label: string;
  note: string;
}[] = [
  { value: "fable", label: "Fable", note: "largest" },
  { value: "opus", label: "Opus", note: "" },
  { value: "sonnet", label: "Sonnet", note: "faster" },
  { value: "haiku", label: "Haiku", note: "fastest" },
];

/** The `@query` the caret sits in: `@` at the start or after whitespace, no space since. */
export function atQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (/\s/.test(ch)) return null;
    if (ch === "@") {
      if (i > 0 && !/\s/.test(text[i - 1])) return null;
      return { start: i, query: text.slice(i + 1, caret) };
    }
  }
  return null;
}

export function matchFiles(
  files: string[],
  query: string,
  limit = 8,
): string[] {
  const needle = query.toLowerCase();
  return files
    .filter((f) => f.toLowerCase().includes(needle))
    .sort((a, b) => a.length - b.length)
    .slice(0, limit);
}

/** The command name being typed: a draft that is one `/word` and nothing else. */
export function slashQuery(text: string): string | null {
  return /^\/\S*$/.test(text) ? text.slice(1) : null;
}

export function matchCommands(
  list: SlashCommand[],
  query: string,
  limit = 8,
): SlashCommand[] {
  const needle = query.toLowerCase();
  const rank = (name: string) =>
    name.toLowerCase().startsWith(needle) ? 0 : 1;
  return list
    .filter((c) => c.name.toLowerCase().includes(needle))
    .sort(
      (a, b) => rank(a.name) - rank(b.name) || a.name.length - b.name.length,
    )
    .slice(0, limit);
}

export function insertAt(
  text: string,
  start: number,
  caret: number,
  path: string,
): { text: string; caret: number } {
  const inserted = `@${path} `;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length,
  };
}

export function pickerFor(text: string): "model" | "resume" | null {
  const t = text.trim();
  return t === "/model" ? "model" : t === "/resume" ? "resume" : null;
}

export function flipsToRaw(text: string): boolean {
  return FLIP_COMMANDS.includes(text.trim().split(/\s+/)[0]);
}

const SUBMIT_GAP_MS = 80;

export const NO_TERMINAL = "no terminal open in that session";
export const ANSWER_FIRST =
  "answer the prompt above first — your message stays here";

/** Text, then the Enter as its own write: a CR in the same chunk lands as a newline. */
export async function sendPrompt(
  key: string,
  text: string,
  write: (k: string, d: string) => Promise<boolean>,
): Promise<boolean> {
  if (!(await write(key, text))) return false;
  await new Promise((resolve) => setTimeout(resolve, SUBMIT_GAP_MS));
  return write(key, "\r");
}

export function fileList(nodeIds: string[], kind: "vault" | "code"): string[] {
  return kind === "vault" ? nodeIds.map((id) => `${id}.md`) : nodeIds;
}
