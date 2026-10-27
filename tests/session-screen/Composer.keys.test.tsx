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

async function mount(
  currentModel = "",
  history: string[] = [],
): Promise<HTMLTextAreaElement> {
  await act(async () => {
    root.render(
      <Composer
        sessionKey={KEY}
        files={[]}
        currentModel={currentModel}
        onError={onError}
        history={history}
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

  it("Up recalls the newest prompt and Down brings the draft back", async () => {
    const box = await mount("", ["first", "second"]);
    await type(box, "draft");
    await press(box, "ArrowUp");
    expect(getDraft(KEY)).toBe("second");
    await press(box, "ArrowUp");
    expect(getDraft(KEY)).toBe("first");
    await press(box, "ArrowDown");
    await press(box, "ArrowDown");
    expect(getDraft(KEY)).toBe("draft");
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("Up below the first line leaves the text alone", async () => {
    const box = await mount("", ["first"]);
    await type(box, "line one\nline two");
    await press(box, "ArrowUp");
    expect(getDraft(KEY)).toBe("line one\nline two");
  });

  it("Up with no history leaves the draft alone", async () => {
    const box = await mount("", []);
    await type(box, "draft");
    await press(box, "ArrowUp");
    expect(getDraft(KEY)).toBe("draft");
  });

  it("typing after a recall ends browsing", async () => {
    const box = await mount("", ["first", "second"]);
    await press(box, "ArrowUp");
    await type(box, "second edited");
    await press(box, "ArrowDown");
    expect(getDraft(KEY)).toBe("second edited");
  });

  it("after a send, Up starts again from the newest prompt", async () => {
    const box = await mount("", ["first", "second"]);
    await press(box, "ArrowUp");
    await press(box, "ArrowUp");
    await press(box, "Enter");
    await settle();
    await press(box, "ArrowUp");
    expect(getDraft(KEY)).toBe("second");
  });

  it("switching session ends browsing", async () => {
    const other = "w2#1";
    setDraft(other, "");
    const box = await mount("", ["a1", "a2"]);
    await press(box, "ArrowUp");
    await press(box, "ArrowUp");
    await act(async () => {
      root.render(
        <Composer
          sessionKey={other}
          files={[]}
          currentModel=""
          onError={onError}
          history={["b1", "b2"]}
        />,
      );
    });
    await press(host.querySelector("textarea")!, "ArrowUp");
    expect(getDraft(other)).toBe("b2");
  });
});
