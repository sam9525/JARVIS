// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Composer from "../../src/renderer/session-screen/Composer";
import { setDraft } from "../../src/renderer/session-screen/drafts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "w1#1";
let host: HTMLDivElement;
let root: Root;
let ptyInput: ReturnType<
  typeof vi.fn<(k: string, d: string) => Promise<boolean>>
>;
let setProperty: ReturnType<typeof vi.fn>;
let removeProperty: ReturnType<typeof vi.fn>;
let scrollIntoView: ReturnType<typeof vi.fn>;

function ui(sessionKey: string, currentModel = "") {
  return (
    <Composer
      sessionKey={sessionKey}
      files={[]}
      currentModel={currentModel}
      onError={vi.fn()}
    />
  );
}

async function mount(sessionKey = KEY): Promise<HTMLTextAreaElement> {
  await act(async () => root.render(ui(sessionKey)));
  const box = host.querySelector("textarea")!;
  Object.defineProperty(box, "offsetHeight", { value: 54 });
  setProperty = vi.fn();
  removeProperty = vi.fn();
  Object.defineProperty(box, "style", {
    value: { setProperty, removeProperty },
  });
  return box;
}

async function type(box: HTMLTextAreaElement, text: string): Promise<void> {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setValue.call(box, text);
    box.setSelectionRange(text.length, text.length);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(el: Element, k: string): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
    );
  });
}

async function pointer(el: Element, type: string, clientY: number) {
  await act(async () => {
    const e = new Event(type, { bubbles: true });
    Object.defineProperty(e, "clientY", { value: clientY });
    Object.defineProperty(e, "pointerId", { value: 1 });
    el.dispatchEvent(e);
  });
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 120)));

beforeEach(() => {
  setDraft(KEY, "");
  ptyInput = vi.fn(async (_k: string, _d: string) => true);
  (window as any).jarvis = {
    ptyInput,
    listTranscripts: vi.fn(async () => []),
    savePastedImage: vi.fn(),
  };
  HTMLElement.prototype.setPointerCapture = vi.fn();
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as any;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Picker height", () => {
  it("is limited to the room above the picker's wrapper", async () => {
    const box = await mount();
    const screenRoot = document.createElement("div");
    screenRoot.setAttribute("data-session-screen", "");
    screenRoot.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    host.replaceWith(screenRoot);
    screenRoot.appendChild(host);
    host.firstElementChild!.getBoundingClientRect = () =>
      ({ top: 100 }) as DOMRect;
    await type(box, "/model");
    const picker = host.querySelector(".bottom-full") as HTMLElement;
    expect(picker.style.maxHeight).toBe("min(40cqh, 94px)");
  });
});

describe("Composer box", () => {
  it("sizes from its content, with no rows attribute", async () => {
    const box = await mount();
    expect(box.hasAttribute("rows")).toBe(false);
    expect(box.className).toContain("[field-sizing:content]");
    expect(box.className).toContain("min-h-[54px]");
    expect(box.className).toContain("max-h-[min(60cqh,calc(100cqh_-_130px))]");
  });

  it("grows while the grip is dragged up, and stops after release", async () => {
    await mount();
    const handle = grip();
    await pointer(handle, "pointerdown", 300);
    expect(handle.hasAttribute("data-dragging")).toBe(true);
    await pointer(handle, "pointermove", 200);
    expect(setProperty).toHaveBeenCalledWith(
      "min-height",
      "min(154px, min(60cqh, calc(100cqh - 130px)))",
    );
    await pointer(handle, "pointerup", 200);
    expect(handle.hasAttribute("data-dragging")).toBe(false);
    setProperty.mockClear();
    await pointer(handle, "pointermove", 100);
    expect(setProperty).not.toHaveBeenCalled();
  });

  it("grows by a step on ArrowUp and stops at the floor on ArrowDown", async () => {
    await mount();
    const handle = grip();
    await key(handle, "ArrowUp");
    expect(setProperty).toHaveBeenCalledWith(
      "min-height",
      "min(74px, min(60cqh, calc(100cqh - 130px)))",
    );
    await key(handle, "ArrowDown");
    expect(setProperty).toHaveBeenLastCalledWith(
      "min-height",
      "min(54px, min(60cqh, calc(100cqh - 130px)))",
    );
  });

  it("keeps focus in the box when the grip is pressed", async () => {
    await mount();
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      grip().dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
  });

  it("returns to the default height on send", async () => {
    const box = await mount();
    await type(box, "hello");
    await key(box, "Enter");
    await settle();
    expect(removeProperty).toHaveBeenCalledWith("min-height");
  });

  it("returns to the default height and restores the prompt when the send fails", async () => {
    ptyInput.mockResolvedValue(false);
    const box = await mount();
    await type(box, "hello");
    await key(box, "Enter");
    await settle();
    expect(removeProperty).toHaveBeenCalledWith("min-height");
    expect(setProperty).not.toHaveBeenCalled();
    expect(box.value).toBe("hello");
  });

  it("returns to the default height on a new session", async () => {
    await mount();
    await act(async () => root.render(ui("w2#1")));
    expect(removeProperty).toHaveBeenCalledWith("min-height");
  });

  it("scrolls the active picker row into view when it changes", async () => {
    const box = await mount();
    await type(box, "/model");
    scrollIntoView.mockClear();
    await key(box, "ArrowDown");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});

function grip(): Element {
  return host.querySelector('[role="separator"]')!;
}
