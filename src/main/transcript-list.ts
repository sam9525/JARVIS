import { promises as fs } from "node:fs";
import path from "node:path";
import { readAiTitle } from "./transcript-title";

export interface TranscriptSummary {
  sessionId: string;
  title: string;
  mtime: number;
  prompts: number;
}

async function countPrompts(file: string): Promise<number> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return 0;
  }
  let prompts = 0;
  for (const line of text.split("\n")) {
    if (!line.includes('"user"')) continue;
    try {
      const parsed = JSON.parse(line) as {
        type?: unknown;
        message?: { content?: unknown };
      };
      if (parsed.type === "user" && typeof parsed.message?.content === "string")
        prompts++;
    } catch {
      continue;
    }
  }
  return prompts;
}

/** The newest `limit` conversations in a Claude Code transcript folder. */
export async function listTranscripts(
  dir: string,
  limit = 20,
): Promise<TranscriptSummary[]> {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const stamped: { name: string; mtime: number }[] = [];
  for (const name of names) {
    try {
      stamped.push({
        name,
        mtime: (await fs.stat(path.join(dir, name))).mtimeMs,
      });
    } catch {
      continue;
    }
  }
  stamped.sort((a, b) => b.mtime - a.mtime);
  return Promise.all(
    stamped.slice(0, limit).map(async ({ name, mtime }) => {
      const file = path.join(dir, name);
      return {
        sessionId: name.slice(0, -".jsonl".length),
        title: (await readAiTitle(file)) ?? "",
        mtime,
        prompts: await countPrompts(file),
      };
    }),
  );
}
