import { describe, it, expect } from "vitest";
import { renderNote } from "../src/renderer/markdown";
import { buildWikilinkResolver } from "../src/shared/wikilink";

// stub vault: nodeId → markdown
const notes: Record<string, string> = {
  "physics/wiki/alpha": "# Alpha\nplain note",
  "physics/wiki/beta": "beta content",
};

const deps = {
  resolveLink: buildWikilinkResolver(Object.keys(notes)),
  loadNote: async (id: string) => notes[id] ?? null,
};

describe("renderNote — standard markdown", () => {
  it("renders gfm tables", async () => {
    const html = await renderNote("| a | b |\n| - | - |\n| 1 | 2 |", deps);
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("renders fenced code blocks", async () => {
    const html = await renderNote("```js\nconst x = 1;\n```", deps);
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });
});

describe("renderNote — wikilinks", () => {
  it("renders resolved wikilink as navigable anchor", async () => {
    const html = await renderNote("see [[beta]]", deps);
    expect(html).toContain(
      '<a class="wikilink" data-node="physics/wiki/beta">beta</a>',
    );
  });

  it("uses the alias as display text", async () => {
    const html = await renderNote("see [[beta|the B note]]", deps);
    expect(html).toContain('data-node="physics/wiki/beta">the B note</a>');
  });

  it("resolves heading links to the note, keeps heading in display", async () => {
    const html = await renderNote("see [[beta#Section]]", deps);
    expect(html).toContain('data-node="physics/wiki/beta">beta#Section</a>');
  });

  it("renders unresolved wikilinks as dimmed spans", async () => {
    const html = await renderNote("see [[ghost note]]", deps);
    expect(html).toContain('<span class="wikilink-broken">ghost note</span>');
    expect(html).not.toContain("data-node");
  });

  it("escapes html in display text", async () => {
    const html = await renderNote("[[ghost|<b>x</b>]]", deps);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
