// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Composer from "../../src/renderer/session-screen/Composer";
import { getDraft, setDraft } from "../../src/renderer/session-screen/drafts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "w1#1";
let host: HTMLDivElement;
let root: Root;
let ptyInput: ReturnType<
  typeof vi.fn<(k: string, d: string) => Promise<boolean>>
>;
let onError: ReturnType<typeof vi.fn<(msg: string | null) => void>>;

async function mount(currentModel = ""): Promise<HTMLTextAreaElement> {
  await act(async () => {
    root.render(
      <Composer
        sessionKey={KEY}
        files={[]}
        currentModel={currentModel}
        onError={onError}
      />,
    );
  });
  return host.querySelector("textarea")!;
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

async function press(box: HTMLTextAreaElement, key: string): Promise<void> {
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 120)));

beforeEach(() => {
  setDraft(KEY, "");
  ptyInput = vi.fn(async (_k: string, _d: string) => true);
  onError = vi.fn((_msg: string | null) => undefined);
  (window as any).jarvis = {
    ptyInput,
    listTranscripts: vi.fn(async () => []),
    savePastedImage: vi.fn(),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Composer keys", () => {
  it("sends once when Enter is pressed twice quickly, and clears at once", async () => {
    const box = await mount();
    await type(box, "hello");
    await press(box, "Enter");
    expect(getDraft(KEY)).toBe("");
    await press(box, "Enter");
    await settle();
    expect(ptyInput.mock.calls).toEqual([
      [KEY, "hello"],
      [KEY, "\r"],
    ]);
  });

  it("keeps what was typed during the send", async () => {
    const box = await mount();
    await type(box, "first");
    await press(box, "Enter");
    await type(box, "second");
    await settle();
    expect(getDraft(KEY)).toBe("second");
  });

  it("restores the prompt when the session has no terminal", async () => {
    ptyInput.mockResolvedValue(false);
    const box = await mount();
    await type(box, "hello");
    await press(box, "Enter");
    await settle();
    expect(getDraft(KEY)).toBe("hello");
    expect(onError).toHaveBeenCalledWith("no terminal open in that session");
  });

  it("reports Esc to a dead terminal", async () => {
    ptyInput.mockResolvedValue(false);
    const box = await mount();
    await press(box, "Escape");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "\x1b");
    expect(onError).toHaveBeenCalledWith("no terminal open in that session");
  });

  it("starts the model picker on the current model", async () => {
    const box = await mount("opus");
    await type(box, "/model");
    await press(box, "Enter");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "/model opus");
  });

  it("sends /resume as typed when there is nothing to pick", async () => {
    const box = await mount();
    await type(box, "/resume");
    await settle();
    await press(box, "Enter");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "/resume");
  });
});
