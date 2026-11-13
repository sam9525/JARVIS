export type KeyLike = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

export const DEFAULT_TERMINAL_TOGGLE = "Ctrl+Backquote";
export const DEFAULT_TODO_TOGGLE = "Ctrl+Shift+KeyT";

const MODIFIER_CODE = /^(Control|Alt|Shift|Meta)(Left|Right)?$/;

const DISPLAY_CODES: Record<string, string> = {
  Backquote: "`",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

export function comboFromEvent(e: KeyLike): string | null {
  if (e.code === "" || MODIFIER_CODE.test(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(e.code);
  return parts.join("+");
}

export function matchesCombo(e: KeyLike, combo: string): boolean {
  return comboFromEvent(e) === combo;
}

// the keys the OS keeps for copy, paste, cut, undo, select-all, quit and close
const SYSTEM_META_KEYS = /^Key[CVXZAQW]$/;

// the keys a terminal session reads for editing, submitting and navigating
const TERMINAL_KEYS = /^(Enter|NumpadEnter|Backspace|Tab|Space|Arrow.*)$/;

export function refusalReason(combo: string, taken?: string): string | null {
  const parts = combo.split("+");
  const code = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const ctrl = mods.has("Ctrl");
  const alt = mods.has("Alt");
  if (!ctrl && !alt && !mods.has("Meta")) return "needs Ctrl, Alt or Meta";
  if ((ctrl || alt) && TERMINAL_KEYS.test(code))
    return "the terminal uses this key";
  if (ctrl && !mods.has("Shift") && /^Key[A-Z]$/.test(code))
    return "the terminal uses this key";
  if (ctrl && mods.has("Shift") && (code === "KeyC" || code === "KeyV"))
    return "the terminal uses this key";
  // the terminal reads Alt+letter as its meta key
  if (alt && /^Key[A-Z]$/.test(code)) return "the terminal uses this key";
  if (mods.has("Meta") && SYSTEM_META_KEYS.test(code))
    return "the system uses this key";
  if (combo === taken) return "the other shortcut uses this key";
  return null;
}

export function formatCombo(combo: string): string {
  return combo
    .split("+")
    .map((part) => {
      if (DISPLAY_CODES[part]) return DISPLAY_CODES[part];
      const key = /^Key([A-Z])$/.exec(part) ?? /^Digit(\d)$/.exec(part);
      return key ? key[1] : part;
    })
    .join("+");
}
