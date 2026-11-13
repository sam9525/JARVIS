// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShortcutRow from "../../src/renderer/ui/ShortcutRow";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

beforeEach(() => {
  onChange.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <ShortcutRow
        label="Terminal"
        testId="sc"
        value={undefined}
        fallback="Ctrl+Backquote"
        taken="Ctrl+Shift+KeyT"
        onChange={onChange}
      />,
    );
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const recordButton = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="sc-record"]')!;
const startRecording = () =>
  act(() => {
    recordButton().click();
  });
const press = (init: KeyboardEventInit) => {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    recordButton().dispatchEvent(e);
  });
  return e;
};

describe("ShortcutRow accessibility", () => {
  it("names the record button by the row label", () => {
    const labelId = recordButton().getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toContain(
      "Terminal",
    );
  });

  it("announces a refusal as a status", () => {
    startRecording();
    press({ code: "KeyB", altKey: true });
    const refusal = container.querySelector('[data-testid="sc-refusal"]')!;
    expect(refusal.getAttribute("role")).toBe("status");
  });

  it.each([{ shiftKey: false }, { shiftKey: true }])(
    "lets Tab through unrecorded while recording %o",
    ({ shiftKey }) => {
      startRecording();
      const e = press({ code: "Tab", shiftKey });
      expect(e.defaultPrevented).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="sc-refusal"]')).toBeNull();
      expect(recordButton().getAttribute("data-key-recorder")).toBeNull();
    },
  );
});
