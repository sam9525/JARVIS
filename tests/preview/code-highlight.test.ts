import { describe, it, expect, vi, afterEach } from "vitest";
import {
  langForPath,
  highlightCode,
  lineClasses,
  previewsAsCode,
} from "../../src/renderer/preview/code-highlight";

let mockShouldThrow = false;
let mockCreateShouldThrow = false;

vi.mock("shiki", async (importOriginal) => {
  const original = await importOriginal<typeof import("shiki")>();
  return {
    ...original,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createHighlighter: async (options: any) => {
      if (mockCreateShouldThrow) {
        throw new Error("Simulated Shiki init failure");
      }
      const hl = await original.createHighlighter(options);
      const originalCodeToHtml = hl.codeToHtml.bind(hl);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hl.codeToHtml = (code: string, opt: any) => {
        if (mockShouldThrow) {
          throw new Error("Simulated Shiki runtime error");
        }
        return originalCodeToHtml(code, opt);
      };
      return hl;
    },
  };
});

describe("langForPath", () => {
  it("maps TypeScript / JavaScript family extensions", () => {
    expect(langForPath("a.ts")).toBe("typescript");
    expect(langForPath("a.mts")).toBe("typescript");
    expect(langForPath("a.cts")).toBe("typescript");
    expect(langForPath("a.tsx")).toBe("tsx");
    expect(langForPath("a.js")).toBe("javascript");
    expect(langForPath("a.mjs")).toBe("javascript");
    expect(langForPath("a.cjs")).toBe("javascript");
    expect(langForPath("a.jsx")).toBe("jsx");
  });

  it("maps other common languages", () => {
    expect(langForPath("a.py")).toBe("python");
    expect(langForPath("a.go")).toBe("go");
    expect(langForPath("a.rs")).toBe("rust");
    expect(langForPath("a.java")).toBe("java");
    expect(langForPath("a.c")).toBe("c");
    expect(langForPath("a.h")).toBe("c");
    expect(langForPath("a.cpp")).toBe("cpp");
    expect(langForPath("a.hpp")).toBe("cpp");
    expect(langForPath("a.cc")).toBe("cpp");
    expect(langForPath("a.cs")).toBe("csharp");
    expect(langForPath("a.rb")).toBe("ruby");
    expect(langForPath("a.php")).toBe("php");
    expect(langForPath("a.json")).toBe("json");
    expect(langForPath("a.yml")).toBe("yaml");
    expect(langForPath("a.yaml")).toBe("yaml");
    expect(langForPath("a.md")).toBe("markdown");
    expect(langForPath("a.css")).toBe("css");
    expect(langForPath("a.scss")).toBe("scss");
    expect(langForPath("a.html")).toBe("html");
    expect(langForPath("a.sh")).toBe("bash");
  });

  it("lowercases the extension before matching", () => {
    expect(langForPath("Main.TS")).toBe("typescript");
    expect(langForPath("STYLE.CSS")).toBe("css");
  });

  it("resolves the extension from a full path with directories", () => {
    expect(langForPath("src/renderer/Preview.tsx")).toBe("tsx");
    expect(langForPath("a/b.c/d.py")).toBe("python");
  });

  it("returns null for unrecognized, extensionless, or dotfile paths", () => {
    expect(langForPath("a.unknownext")).toBeNull();
    expect(langForPath("README")).toBeNull();
    expect(langForPath(".gitignore")).toBeNull();
    expect(langForPath("dir/.env")).toBeNull();
    expect(langForPath("a.b.c/README")).toBeNull();
  });
});

describe("highlightCode", () => {
  // MUST stay the first test in this block. `highlighterPromise` is a
  // module-level singleton that only the failure path clears, and afterEach
  // resets the mock flags but not the module. Any earlier test that resolves a
  // real highlighter memoizes it, `createHighlighter` is never called again,
  // the simulated init failure can't happen, and this fails on the very first
  // assertion — looking like a Shiki regression rather than a test-order bug.
  // Add new cases below it, never above.
  it("retries the highlighter after a failed init instead of staying plaintext", async () => {
    mockCreateShouldThrow = true;
    const first = await highlightCode("const x = 1;", "test.ts");
    expect(first).toContain("pre"); // fallback, no color
    expect(first).not.toContain('style="color:');

    mockCreateShouldThrow = false;
    const second = await highlightCode("const x = 1;", "test.ts");
    expect(second).toContain('style="color:'); // recovered
  });

  it("highlights code using the matching language grammar", async () => {
    const code = "const x: number = 42;";
    const html = await highlightCode(code, "test.ts");
    expect(html).toContain("pre");
    expect(html).toContain("shiki");
    expect(html).toContain('style="color:');
    expect(html).toContain("const");
    expect(html).toContain("42");
  });

  it("falls back to text for unrecognized extensions", async () => {
    const code = "some random data";
    const html = await highlightCode(code, "test.unknown");
    expect(html).toContain("pre");
    expect(html).toContain("shiki");
    expect(html).toContain("some random data");
  });

  it("never throws and returns fallback HTML if highlighter throws", async () => {
    mockShouldThrow = true;
    const code = 'const x = "hello" & "world"; <tag>';
    const html = await highlightCode(code, "test.ts");
    expect(html).toContain("pre");
    expect(html).toContain("shiki");
    expect(html).toContain("dark-plus");
    expect(html).toContain(
      "const x = &quot;hello&quot; &amp; &quot;world&quot;; &lt;tag&gt;",
    );
  });

  // the line-number gutter counts .line spans, so both renderers must emit
  // exactly one per source line, blank lines included
  it("emits one .line span per source line", async () => {
    const code = "const a = 1;\n\nconst b = 2;";
    const count = (html: string) => html.match(/class="line/g)?.length;
    expect(count(await highlightCode(code, "test.ts"))).toBe(3);
    mockShouldThrow = true;
    expect(count(await highlightCode(code, "test.ts"))).toBe(3);
  });

  it("puts git markers on the changed lines in both renderers", async () => {
    const code = "a\nb\nc";
    const changes = { added: [2], removedAfter: [3] };
    const classesOf = (html: string) =>
      [...html.matchAll(/<span class="(line[^"]*)"/g)].map((m) => m[1]);
    const expected = ["line", "line diff-add", "line diff-del-after"];
    expect(classesOf(await highlightCode(code, "test.ts", changes))).toEqual(
      expected,
    );
    mockShouldThrow = true;
    expect(classesOf(await highlightCode(code, "test.ts", changes))).toEqual(
      expected,
    );
  });
});

describe("lineClasses", () => {
  const changes = { added: [1, 4], removedAfter: [0, 4] };

  it("marks an added line", () => {
    expect(lineClasses(changes, 4)).toContain("diff-add");
  });

  it("marks the line above a deletion, and line 1 for a top deletion", () => {
    expect(lineClasses(changes, 4)).toContain("diff-del-after");
    expect(lineClasses(changes, 1)).toEqual(["diff-add", "diff-del-before"]);
  });

  it("leaves an unchanged line bare", () => {
    expect(lineClasses(changes, 2)).toEqual([]);
  });
});

afterEach(() => {
  mockShouldThrow = false;
  mockCreateShouldThrow = false;
});

describe("previewsAsCode", () => {
  it("keeps source files in a code workspace on the highlighter", () => {
    expect(previewsAsCode(true, "src/main/main.ts")).toBe(true);
    expect(previewsAsCode(true, "Makefile")).toBe(true);
  });

  it("routes markdown in a code workspace to the note renderer", () => {
    expect(previewsAsCode(true, "docs/spec.md")).toBe(false);
    expect(previewsAsCode(true, "README.MD")).toBe(false);
  });

  it("never sends a vault note to the highlighter", () => {
    expect(previewsAsCode(false, "notes/idea")).toBe(false);
    expect(previewsAsCode(false, "a.ts")).toBe(false);
  });
});
