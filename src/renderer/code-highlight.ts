import { createHighlighter, createJavaScriptRegexEngine } from "shiki";
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
    // shiki's default engine loads a WASM oniguruma binary, which the
    // renderer's CSP (script-src 'self', no 'wasm-unsafe-eval') silently
    // blocks — falling through to the colorless fallback below. The JS
    // regex engine gets the same grammars with no WASM involved.
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return m;
    }
  });
}

export async function highlightCode(
  code: string,
  path: string,
): Promise<string> {
  try {
    const lang = langForPath(path) ?? "text"; // "text" is a special always-loaded lang
    const hl = await getHighlighter();
    if (lang !== "text" && !hl.getLoadedLanguages().includes(lang)) {
      await hl.loadLanguage(lang as BundledLanguage);
    }
    return hl.codeToHtml(code, { lang, theme: THEME });
  } catch (error) {
    const escaped = escapeHtml(code);
    return `<pre class="shiki dark-plus" style="background-color:#1e1e1e;color:#d4d4d4;"><code>${escaped}</code></pre>`;
  }
}
