import { describe, expect, it } from "vitest";
import { createPendingInput } from "../../src/main/pending-input";

describe("createPendingInput", () => {
  const p = createPendingInput();
  it("typed text is pending until Enter", () => {
    p.note("k", "hel");
    expect(p.has("k")).toBe(true);
    p.note("k", "\r");
    expect(p.has("k")).toBe(false);
  });
  it("text and Enter in one chunk leave nothing pending", () => {
    p.note("k", "/clear\r");
    expect(p.has("k")).toBe(false);
  });
  it("escape sequences alone are not typing", () => {
    for (const seq of ["\x1b[I", "\x1b[O", "\x1b[A", "\x1b"]) p.note("j", seq);
    expect(p.has("j")).toBe(false);
  });
  it("a bracketed paste marks pending", () => {
    p.note("paste", "\x1b[200~hello\x1b[201~");
    expect(p.has("paste")).toBe(true);
  });
  it("a bracketed paste containing a CR still marks pending", () => {
    p.note("m", "\x1b[200~a\rb\x1b[201~");
    expect(p.has("m")).toBe(true);
  });
  it("a focus report alone does not mark pending", () => {
    p.note("f", "\x1b[I");
    expect(p.has("f")).toBe(false);
  });
  it("Ctrl+C clears", () => {
    p.note("c", "abc");
    p.note("c", "\x03");
    expect(p.has("c")).toBe(false);
  });
  it("clear drops a key", () => {
    p.note("x", "abc");
    p.clear("x");
    expect(p.has("x")).toBe(false);
  });
  it("keys are independent", () => {
    p.note("a", "abc");
    expect(p.has("b")).toBe(false);
  });
});
