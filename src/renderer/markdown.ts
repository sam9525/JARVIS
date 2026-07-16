import { Marked } from "marked";
import type { Tokens } from "marked";

export type RenderDeps = {
  resolveLink: (target: string) => string | null;
  loadNote: (nodeId: string) => Promise<string | null>;
};

// [[target]], [[target#heading]], [[target|alias]] — same shape as the
// vault scanner's WIKILINK, anchored for the inline tokenizer
const WIKILINK = /^\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/;

// anchored (inline tokenizer) and global (pre-pass scan) embed patterns
const EMBED = /^!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/;
const EMBED_ALL = /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MAX_EMBED_DEPTH = 5;

// first <p> of a rendered blockquote: "[!type]" + optional fold +/- + title
const CALLOUT = /^<p>\[!([a-zA-Z]+)\]([+-])?[ \t]*/;
const CALLOUT_TYPES = new Set([
  "note",
  "info",
  "tip",
  "warning",
  "danger",
  "quote",
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type WikilinkToken = Tokens.Generic & { target: string; display: string };

export async function renderNote(
  md: string,
  deps: RenderDeps,
): Promise<string> {
  const contents = new Map<string, string>();
  await collectEmbeds(md, deps, contents);
  return render(md, deps.resolveLink, contents, new Set());
}

// load every reachable embed target once; the visited map doubles as the
// cycle-guard for loading (render-time ancestor sets handle cycle display)
async function collectEmbeds(
  md: string,
  deps: RenderDeps,
  out: Map<string, string>,
): Promise<void> {
  for (const m of md.matchAll(EMBED_ALL)) {
    const id = deps.resolveLink(m[1].trim());
    if (!id || out.has(id)) continue;
    const content = await deps.loadNote(id);
    if (content === null) continue; // unreadable → not-found chip at render
    out.set(id, content);
    await collectEmbeds(content, deps, out);
  }
}

function render(
  md: string,
  resolveLink: (target: string) => string | null,
  contents: Map<string, string>,
  ancestors: Set<string>,
): string {
  const marked = new Marked({
    extensions: [
      {
        name: "embed",
        level: "inline",
        start: (src: string) => src.indexOf("![["),
        tokenizer(src: string) {
          const m = EMBED.exec(src);
          if (!m) return undefined;
          return { type: "embed", raw: m[0], target: m[1].trim() };
        },
        renderer(token) {
          const t = token as Tokens.Generic & { target: string };
          const id = resolveLink(t.target);
          if (!id || !contents.has(id))
            return `<span class="embed-chip">${escapeHtml(t.target)} (not found)</span>`;
          if (ancestors.has(id))
            return `<span class="embed-chip">${escapeHtml(id)} (circular embed)</span>`;
          if (ancestors.size >= MAX_EMBED_DEPTH)
            return `<span class="embed-chip">${escapeHtml(id)} (too deep)</span>`;
          const inner = render(
            contents.get(id) as string,
            resolveLink,
            contents,
            new Set([...ancestors, id]),
          );
          return `<div class="embed"><div class="embed-title">${escapeHtml(id)}</div><div class="embed-body">${inner}</div></div>`;
        },
      },
      {
        name: "wikilink",
        level: "inline",
        start: (src: string) => src.indexOf("[["),
        tokenizer(src: string) {
          const m = WIKILINK.exec(src);
          if (!m) return undefined;
          const target = m[1].trim();
          const display = (m[3] ?? target + (m[2] ?? "")).trim();
          return { type: "wikilink", raw: m[0], target, display };
        },
        renderer(token) {
          const t = token as WikilinkToken;
          const id = resolveLink(t.target);
          if (!id)
            return `<span class="wikilink-broken">${escapeHtml(t.display)}</span>`;
          return `<a class="wikilink" data-node="${escapeHtml(id)}">${escapeHtml(t.display)}</a>`;
        },
      },
    ],
    renderer: {
      blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        const m = CALLOUT.exec(body);
        if (!m) return `<blockquote>\n${body}</blockquote>\n`;

        const raw = m[1].toLowerCase();
        const type = CALLOUT_TYPES.has(raw) ? raw : "note";
        // first <p> holds "[!type] Title\nrest of paragraph" — the title is
        // everything up to the first newline or </p>, whichever comes first
        const after = body.slice(m[0].length);
        const nl = after.indexOf("\n");
        const endP = after.indexOf("</p>");
        let title: string;
        let rest: string;
        if (nl !== -1 && (endP === -1 || nl < endP)) {
          title = after.slice(0, nl);
          rest = "<p>" + after.slice(nl + 1);
        } else {
          title = endP === -1 ? after : after.slice(0, endP);
          rest = endP === -1 ? "" : after.slice(endP + "</p>".length);
        }
        const heading = title.trim() || m[1].toLowerCase();
        // ponytail: title is already-rendered inline HTML from our own parse
        // — do not escape it, escaping would break links/bold in titles
        return `<div class="callout" data-type="${type}"><div class="callout-title">${heading}</div>${rest}</div>`;
      },
    },
  });
  return marked.parse(md, { async: false }) as string;
}
