import { Marked } from "marked";
import type { Tokens } from "marked";

export type RenderDeps = {
  resolveLink: (target: string) => string | null;
  loadNote: (nodeId: string) => Promise<string | null>;
};

// [[target]], [[target#heading]], [[target|alias]] — same shape as the
// vault scanner's WIKILINK, anchored for the inline tokenizer
const WIKILINK = /^\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/;

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
  });
  return marked.parse(md, { async: false }) as string;
}
