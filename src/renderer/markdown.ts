import { Marked } from "marked";
import type { Tokens } from "marked";

export type RenderDeps = {
  resolveLink: (target: string) => string | null;
  loadNote: (nodeId: string) => Promise<string | null>;
};

// [[target]], [[target#heading]], [[target|alias]] — same shape as the
// vault scanner's WIKILINK, anchored for the inline tokenizer
const WIKILINK = /^\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/;

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
  return render(md, deps.resolveLink);
}

function render(
  md: string,
  resolveLink: (target: string) => string | null,
): string {
  const marked = new Marked({
    extensions: [
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
