import { createHighlighter, createJavaScriptRegexEngine } from "shiki";
import type { BundledLanguage, Highlighter } from "shiki";
import type { LineChanges } from "../../shared/types";

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

// Which of the two preview renderers a file takes. Markdown is a document
// wherever it lives: a README or a spec inside a code repo goes to the note
// renderer, or the highlighter prints its "##" as literal source.
export function previewsAsCode(codeWorkspace: boolean, path: string): boolean {
  return codeWorkspace && langForPath(path) !== "markdown";
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
    }).catch((err) => {
      // don't memoize a rejection — one bad init would mean colorless
      // previews for the rest of the session
      highlighterPromise = null;
      throw err;
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

/** Gutter marker classes for one 1-based line. A deletion is drawn on the edge
 * of the line above it, or on line 1's top edge when the top was removed. */
export function lineClasses(changes: LineChanges, line: number): string[] {
  const classes: string[] = [];
  if (changes.added.includes(line)) classes.push("diff-add");
  if (changes.modified.includes(line)) classes.push("diff-mod");
  if (changes.removedAfter.includes(line)) classes.push("diff-del-after");
  if (line === 1 && changes.removedAfter.includes(0))
    classes.push("diff-del-before");
  return classes;
}

const NO_CHANGES: LineChanges = { added: [], modified: [], removedAfter: [] };

export async function highlightCode(
  code: string,
  path: string,
  changes: LineChanges = NO_CHANGES,
): Promise<string> {
  try {
    const lang = langForPath(path) ?? "text"; // "text" is a special always-loaded lang
    const hl = await getHighlighter();
    if (lang !== "text" && !hl.getLoadedLanguages().includes(lang)) {
      // dynamic grammar chunk import — unverified under a packaged file://
      // origin, where CSP 'self' matching is unreliable; the catch below
      // degrades it to plaintext rather than breaking the preview
      await hl.loadLanguage(lang as BundledLanguage);
    }
    return hl.codeToHtml(code, {
      lang,
      theme: THEME,
      transformers: [
        {
          line(node, line) {
            for (const c of lineClasses(changes, line))
              this.addClassToHast(node, c);
          },
        },
      ],
    });
  } catch (error) {
    // one span.line per source line, joined the way Shiki joins them, so the
    // line-number gutter works on the plaintext fallback too
    const lines = code
      .split("\n")
      .map((l, i) => {
        const cls = ["line", ...lineClasses(changes, i + 1)].join(" ");
        return `<span class="${cls}">${escapeHtml(l)}</span>`;
      })
      .join("\n");
    return `<pre class="shiki dark-plus" style="background-color:#1e1e1e;color:#d4d4d4;"><code>${lines}</code></pre>`;
  }
}
