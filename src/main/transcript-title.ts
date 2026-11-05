import { promises as fs } from "node:fs";
import { cleanLabel } from "../shared/session-key";

export async function readAiTitle(
  transcriptPath: string,
): Promise<string | null> {
  let text: string;
  try {
    // ponytail: reads the whole file; read the tail if transcripts grow past a few MB.
    text = await fs.readFile(transcriptPath, "utf8");
  } catch {
    return null;
  }
  let title: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"ai-title"')) continue;
    try {
      const parsed = JSON.parse(line) as { type?: unknown; aiTitle?: unknown };
      if (parsed.type === "ai-title" && typeof parsed.aiTitle === "string") {
        title = parsed.aiTitle;
      }
    } catch {
      continue;
    }
  }
  return title;
}

export function topicWord(aiTitle: string, workspaceName: string): string {
  const workspace = workspaceName.toLowerCase();
  const word = aiTitle
    .split(/\s+/)
    .find((candidate) => candidate && candidate.toLowerCase() !== workspace);
  if (!word) return "";
  return cleanLabel(word.toLowerCase()).replace(/^-+|-+$/g, "");
}
