// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Composer from "../../src/renderer/session-screen/Composer";
import { ANSWER_FIRST } from "../../src/renderer/session-screen/composer-logic";
import { getDraft, setDraft } from "../../src/renderer/session-screen/drafts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "w1#gate";
let host: HTMLDivElement;
let root: Root;
const ptyInput = vi.fn(async (_k: string, _d: string) => true);
const onError = vi.fn((_msg: string | null) => undefined);

async function mount(awaitingAnswer: boolean): Promise<HTMLTextAreaElement> {
  await act(async () => {
    root.render(
      <Composer
        sessionKey={KEY}
        files={[]}
        currentModel=""
        onError={onError}
        awaitingAnswer={awaitingAnswer}
      />,
    );
  });
  return host.querySelector("textarea")!;
}

const pressEnter = (box: HTMLTextAreaElement) =>
  act(async () => {
    box.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });

beforeEach(() => {
  ptyInput.mockClear();
  onError.mockClear();
  setDraft(KEY, "no, don't do that");
  (window as any).jarvis = { ptyInput, listTranscripts: vi.fn(async () => []) };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Composer while a prompt is open", () => {
  it("writes nothing on Enter and keeps the draft", async () => {
    await pressEnter(await mount(true));
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(ptyInput).not.toHaveBeenCalled();
    expect(getDraft(KEY)).toBe("no, don't do that");
    expect(onError).toHaveBeenCalledWith(ANSWER_FIRST);
  });

  it("sends the kept draft once the prompt closes", async () => {
    const box = await mount(true);
    await pressEnter(box);
    await mount(false);
    await pressEnter(box);
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(ptyInput.mock.calls).toEqual([
      [KEY, "no, don't do that"],
      [KEY, "\r"],
    ]);
  });
});
