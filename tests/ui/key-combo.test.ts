import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_TOGGLE,
  comboFromEvent,
  formatCombo,
  matchesCombo,
  refusalReason,
  type KeyLike,
} from "../../src/renderer/ui/key-combo";

const k = (code: string, m: Partial<KeyLike> = {}): KeyLike => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...m,
});

describe("key combos", () => {
  it("builds combos in Ctrl+Alt+Shift+Meta order", () => {
    expect(comboFromEvent(k("Backquote", { ctrlKey: true }))).toBe(
      "Ctrl+Backquote",
    );
    expect(comboFromEvent(k("KeyT", { shiftKey: true, altKey: true }))).toBe(
      "Alt+Shift+KeyT",
    );
  });

  it("returns null for a modifier alone", () => {
    expect(comboFromEvent(k("ControlLeft", { ctrlKey: true }))).toBeNull();
  });

  it("matches only the exact modifiers", () => {
    expect(
      matchesCombo(k("Backquote", { ctrlKey: true }), DEFAULT_TERMINAL_TOGGLE),
    ).toBe(true);
    expect(
      matchesCombo(
        k("Backquote", { ctrlKey: true, shiftKey: true }),
        DEFAULT_TERMINAL_TOGGLE,
      ),
    ).toBe(false);
  });

  it("refuses bare keys and keys session input needs", () => {
    for (const c of [
      "Backquote",
      "Shift+Enter",
      "F5",
      "Ctrl+KeyC",
      "Ctrl+KeyY",
      "Ctrl+KeyV",
      "Alt+Enter",
      "Ctrl+ArrowUp",
      "Ctrl+Space",
      "Ctrl+Tab",
      "Ctrl+Backspace",
      "Ctrl+Shift+KeyC",
      "Ctrl+Shift+KeyV",
    ])
      expect(refusalReason(c)).not.toBeNull();
  });

  it("allows the default and other modified keys", () => {
    for (const c of [
      "Ctrl+Backquote",
      "Alt+KeyT",
      "Ctrl+Shift+KeyT",
      "Ctrl+F2",
    ])
      expect(refusalReason(c)).toBeNull();
  });

  it("formats for display", () => {
    expect(formatCombo("Ctrl+Backquote")).toBe("Ctrl+`");
    expect(formatCombo("Alt+Shift+KeyT")).toBe("Alt+Shift+T");
    expect(formatCombo("Ctrl+ArrowUp")).toBe("Ctrl+↑");
    expect(formatCombo("Alt+Digit5")).toBe("Alt+5");
  });
});
