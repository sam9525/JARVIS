import { describe, it, expect, vi, afterEach } from "vitest";
import { langForPath, highlightCode } from "../src/renderer/code-highlight";

let mockShouldThrow = false;

vi.mock("shiki", async (importOriginal) => {
  const original = await importOriginal<typeof import("shiki")>();
  return {
    ...original,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createHighlighter: async (options: any) => {
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
});

afterEach(() => {
  mockShouldThrow = false;
});
