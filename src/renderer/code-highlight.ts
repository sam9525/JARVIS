import { createHighlighter } from "shiki";
import type { BundledLanguage, Highlighter } from "shiki";

const THEME = "dark-plus";

// file extension (lowercased, no dot) → Shiki bundled-language id
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  sh: "bash",
  bash: "bash",
  toml: "toml",
  sql: "sql",
  kt: "kotlin",
  swift: "swift",
};

export function langForPath(path: string): string | null {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  // no dot after the final separator, or a leading-dot file like ".gitignore"
  if (dot <= slash + 1) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

// lazy singleton — created on first code preview, reused for the whole session.
// Grammars load on first use of a language, not all upfront.
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: [THEME], langs: [] });
  }
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  path: string,
): Promise<string> {
  const lang = langForPath(path) ?? "text"; // "text" is a special always-loaded lang
  const hl = await getHighlighter();
  if (lang !== "text" && !hl.getLoadedLanguages().includes(lang)) {
    await hl.loadLanguage(lang as BundledLanguage);
  }
  return hl.codeToHtml(code, { lang, theme: THEME });
}
