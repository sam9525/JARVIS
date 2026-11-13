import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_TOGGLE,
  DEFAULT_TODO_TOGGLE,
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

  it("returns null for an event with no code", () => {
    expect(comboFromEvent(k("", { ctrlKey: true }))).toBeNull();
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
      "Alt+Digit1",
      "Ctrl+Shift+KeyT",
      "Ctrl+F2",
      "Meta+KeyK",
    ])
      expect(refusalReason(c)).toBeNull();
  });

  it("refuses the system clipboard, undo, select-all, quit and close keys", () => {
    for (const c of [
      "Meta+KeyC",
      "Meta+KeyV",
      "Meta+KeyX",
      "Meta+KeyZ",
      "Meta+KeyA",
      "Meta+KeyQ",
      "Meta+KeyW",
      "Shift+Meta+KeyZ",
    ])
      expect(refusalReason(c)).toBe("the system uses this key");
  });

  it("refuses Alt plus a letter, which the terminal reads as meta", () => {
    for (const c of ["Alt+KeyB", "Alt+Shift+KeyF"])
      expect(refusalReason(c)).toBe("the terminal uses this key");
  });

  it("refuses the combo the other shortcut holds", () => {
    expect(refusalReason("Ctrl+Backquote", "Ctrl+Backquote")).toBe(
      "the other shortcut uses this key",
    );
    expect(refusalReason("Ctrl+Shift+KeyT", "Ctrl+Backquote")).toBeNull();
  });

  it("allows the to-do default", () => {
    expect(DEFAULT_TODO_TOGGLE).toBe("Ctrl+Shift+KeyT");
    expect(refusalReason(DEFAULT_TODO_TOGGLE)).toBeNull();
    expect(formatCombo(DEFAULT_TODO_TOGGLE)).toBe("Ctrl+Shift+T");
  });

  it("formats for display", () => {
    expect(formatCombo("Ctrl+Backquote")).toBe("Ctrl+`");
    expect(formatCombo("Alt+Shift+KeyT")).toBe("Alt+Shift+T");
    expect(formatCombo("Ctrl+ArrowUp")).toBe("Ctrl+↑");
    expect(formatCombo("Alt+Digit5")).toBe("Alt+5");
  });
});
