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
let listCommands: ReturnType<
  typeof vi.fn<(k: string) => Promise<{ name: string; description: string }[]>>
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
  listCommands = vi.fn(async (_k: string) => [
    { name: "write-plan", description: "Plan it" },
    { name: "review", description: "Review it" },
  ]);
  onError = vi.fn((_msg: string | null) => undefined);
  (window as any).jarvis = {
    ptyInput,
    listTranscripts: vi.fn(async () => []),
    listCommands,
    savePastedImage: vi.fn(),
  };
  // jsdom has no scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
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

  it("recalling a bare /model opens the picker on the model in use", async () => {
    const box = await mount("sonnet", ["/model"]);
    await press(box, "ArrowUp");
    await press(box, "Enter");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "/model sonnet");
  });

  it("recalling the text already in the box leaves no caret jump behind", async () => {
    const box = await mount("", ["yes"]);
    await type(box, "yes");
    await press(box, "ArrowUp");
    await type(box, "yesX");
    expect(box.selectionStart).toBe(4);
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

describe("Composer slash list", () => {
  it("opens on / and Enter inserts the name without sending", async () => {
    const box = await mount();
    await type(box, "/wri");
    await settle();
    expect(host.textContent).toContain("/write-plan");
    expect(host.textContent).toContain("Plan it");
    await press(box, "Enter");
    expect(getDraft(KEY)).toBe("/write-plan ");
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("Enter on the exact name sends it", async () => {
    const box = await mount();
    await type(box, "/review");
    await settle();
    await press(box, "Enter");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "/review");
  });

  it("Tab inserts like Enter", async () => {
    const box = await mount();
    await type(box, "/wri");
    await settle();
    await press(box, "Tab");
    expect(getDraft(KEY)).toBe("/write-plan ");
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("Esc keeps the text and closes the list", async () => {
    const box = await mount();
    await type(box, "/wri");
    await settle();
    await press(box, "Escape");
    expect(getDraft(KEY)).toBe("/wri");
    expect(host.textContent).not.toContain("/write-plan");
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("sends /clear on Enter when nothing matches", async () => {
    const box = await mount();
    await type(box, "/clear");
    await settle();
    await press(box, "Enter");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "/clear");
  });

  it("keeps /model for the model picker", async () => {
    const box = await mount("opus");
    await type(box, "/model");
    await settle();
    expect(host.textContent).toContain("Switch model");
  });

  it("ignores a late reply for the previous session", async () => {
    const other = "w2#1";
    setDraft(other, "/");
    let release: (v: { name: string; description: string }[]) => void = () =>
      undefined;
    listCommands.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    setDraft(KEY, "/");
    await mount();
    listCommands.mockResolvedValueOnce([{ name: "fresh", description: "" }]);
    await act(async () => {
      root.render(
        <Composer
          sessionKey={other}
          files={[]}
          currentModel=""
          onError={onError}
        />,
      );
    });
    await settle();
    await act(async () => release([{ name: "stale", description: "" }]));
    expect(host.textContent).toContain("/fresh");
    expect(host.textContent).not.toContain("/stale");
  });
});

describe("Composer slash list edge cases", () => {
  const load = (names: string[]) =>
    listCommands.mockResolvedValue(
      names.map((name) => ({ name, description: "" })),
    );

  it("sends a built-in name on Enter although a longer skill matches", async () => {
    load(["init-project"]);
    const box = await mount();
    await type(box, "/init");
    await settle();
    expect(host.textContent).toContain("/init-project");
    await press(box, "Enter");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "/init");
  });

  it("sends /init on Enter when a skill is named exactly init", async () => {
    load(["init", "init-project"]);
    const box = await mount();
    await type(box, "/init");
    await settle();
    await press(box, "Enter");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "/init");
  });

  it("inserts the skill for a partial built-in name", async () => {
    load(["init-project"]);
    const box = await mount();
    await type(box, "/ini");
    await settle();
    await press(box, "Enter");
    expect(getDraft(KEY)).toBe("/init-project ");
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("Tab on an exact name inserts it and writes nothing", async () => {
    load(["tdd"]);
    const box = await mount();
    await type(box, "/tdd");
    await settle();
    await press(box, "Tab");
    expect(getDraft(KEY)).toBe("/tdd ");
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("a click on the exact row inserts it and writes nothing", async () => {
    load(["tdd"]);
    const box = await mount();
    await type(box, "/tdd");
    await settle();
    const row = host.querySelector("button")!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await settle();
    expect(getDraft(KEY)).toBe("/tdd ");
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("a recalled /tdd opens no list and Up goes on to older prompts", async () => {
    load(["tdd"]);
    const box = await mount("", ["older", "/tdd"]);
    await press(box, "ArrowUp");
    await settle();
    expect(getDraft(KEY)).toBe("/tdd");
    expect(host.querySelector("button")).toBeNull();
    await press(box, "ArrowUp");
    expect(getDraft(KEY)).toBe("older");
  });

  it("a session switch resets the active row", async () => {
    load(["aaa", "bbb", "ccc"]);
    const other = "w2#1";
    setDraft(other, "/");
    setDraft(KEY, "/");
    const box = await mount();
    await settle();
    await press(box, "ArrowDown");
    await press(box, "ArrowDown");
    await act(async () => {
      root.render(
        <Composer
          sessionKey={other}
          files={[]}
          currentModel=""
          onError={onError}
        />,
      );
    });
    await settle();
    await press(host.querySelector("textarea")!, "Enter");
    expect(getDraft(other)).toBe("/aaa ");
  });

  it("sends a path-like draft as typed", async () => {
    load(["usr"]);
    const box = await mount();
    await type(box, "/usr/bin/x");
    await settle();
    await press(box, "Enter");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "/usr/bin/x");
  });

  it("a multi-line draft starting with / opens no list and sends", async () => {
    load(["usr"]);
    const box = await mount();
    await type(box, "/usr\nmore");
    await settle();
    expect(host.querySelector("button")).toBeNull();
    await press(box, "Enter");
    await settle();
    expect(ptyInput).toHaveBeenCalledWith(KEY, "/usr\nmore");
  });
});
