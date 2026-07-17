import { describe, it, expect } from "vitest";
import { renderNote } from "../src/renderer/markdown";
import { buildWikilinkResolver } from "../src/shared/wikilink";

// stub vault: nodeId → markdown
const notes: Record<string, string> = {
  "physics/wiki/alpha": "# Alpha\nplain note",
  "physics/wiki/beta": "beta content",
  "physics/wiki/outer": "before ![[inner]] after",
  "physics/wiki/inner": "inner text",
  "physics/wiki/loop-a": "a embeds ![[loop-b]]",
  "physics/wiki/loop-b": "b embeds ![[loop-a]]",
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

describe("renderNote — callouts", () => {
  it("renders a typed callout with title and body", async () => {
    const html = await renderNote(
      "> [!warning] Hot surface\n> do not touch",
      deps,
    );
    expect(html).toContain('<div class="callout" data-type="warning">');
    expect(html).toContain('<div class="callout-title">Hot surface</div>');
    expect(html).toContain("do not touch");
    expect(html).not.toContain("[!warning]");
  });

  it("defaults the title to the type when none given", async () => {
    const html = await renderNote("> [!tip]\n> stay hydrated", deps);
    expect(html).toContain('<div class="callout-title">tip</div>');
    expect(html).toContain("stay hydrated");
  });

  it("falls back to note styling for unknown types", async () => {
    const html = await renderNote("> [!zebra] Odd\n> body", deps);
    expect(html).toContain('data-type="note"');
    expect(html).toContain('<div class="callout-title">Odd</div>');
  });

  it("renders fold markers expanded (v1: no collapse)", async () => {
    const html = await renderNote("> [!note]- Folded\n> hidden?", deps);
    expect(html).toContain('data-type="note"');
    expect(html).toContain("hidden?");
  });

  it("leaves plain blockquotes untouched", async () => {
    const html = await renderNote("> just a quote", deps);
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("callout");
  });
});

describe("renderNote — embeds", () => {
  it("transcludes the target note inline", async () => {
    const html = await renderNote("intro ![[inner]] outro", deps);
    expect(html).toContain('<div class="embed">');
    expect(html).toContain('<div class="embed-title">physics/wiki/inner</div>');
    expect(html).toContain("inner text");
  });

  it("transcludes nested embeds", async () => {
    const html = await renderNote("![[outer]]", deps);
    expect(html).toContain("physics/wiki/outer");
    expect(html).toContain("inner text"); // outer's embed rendered too
  });

  it("marks circular embeds instead of recursing forever", async () => {
    const html = await renderNote("![[loop-a]]", deps);
    expect(html).toContain("circular embed");
    expect(html).toContain("a embeds"); // first level still rendered
  });

  it("marks unresolvable embeds", async () => {
    const html = await renderNote("![[ghost]]", deps);
    expect(html).toContain('<span class="embed-chip">');
    expect(html).toContain("not found");
  });

  it("wikilinks inside embedded notes still resolve", async () => {
    notes["physics/wiki/linky"] = "see [[beta]]";
    deps.resolveLink = buildWikilinkResolver(Object.keys(notes));
    const html = await renderNote("![[linky]]", deps);
    expect(html).toContain('data-node="physics/wiki/beta"');
  });
});

describe("renderNote — resilience", () => {
  it("resolves instead of throwing when loadNote rejects", async () => {
    const html = await renderNote("![[beta]] and [[beta]]", {
      resolveLink: deps.resolveLink,
      loadNote: async () => {
        throw new Error("ipc exploded");
      },
    });
    expect(html).toContain("not found"); // embed degrades to chip
    expect(html).toContain("data-node"); // wikilink still renders
  });

  it("caps embed depth with a too-deep chip", async () => {
    for (let i = 1; i <= 6; i++) {
      notes[`physics/wiki/deep-${i}`] =
        i < 6 ? `level ${i} ![[deep-${i + 1}]]` : "bottom";
    }
    deps.resolveLink = buildWikilinkResolver(Object.keys(notes));
    const html = await renderNote("![[deep-1]]", deps);
    expect(html).toContain("level 5");
    expect(html).toContain("(too deep)");
    expect(html).not.toContain("bottom");
  });
});
