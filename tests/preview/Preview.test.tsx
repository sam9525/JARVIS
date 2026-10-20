// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import Preview from "../../src/renderer/preview/Preview";
import type { Workspace } from "../../src/shared/types";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../src/renderer/preview/code-highlight", async (orig) => ({
  ...(await orig<typeof import("../../src/renderer/preview/code-highlight")>()),
  highlightCode: async (code: string, _path: string, changes: any) =>
    `<pre data-added="${changes.added.join(",")}">${code}</pre>`,
}));

const ws: Workspace = {
  id: "w",
  name: "w",
  rootPath: "/tmp/w",
  kind: "code",
  sourceId: "gitnexus",
};

// stable, as App memoizes it: a new function per render would re-read on its own
const resolveLink = () => null;
const noop = () => undefined;

let files: Record<string, string>;
let added: number[];
let root: Root;
let container: HTMLDivElement;
const scrollTo = vi.fn();

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const show = (nodeId: string, revision: number) =>
  act(() => {
    root.render(
      <Preview
        nodeId={nodeId}
        revision={revision}
        workspace={ws}
        resolveLink={resolveLink}
        onNavigate={noop}
        onClose={noop}
      />,
    );
  });

beforeEach(() => {
  files = { "a.ts": "old text", "b.ts": "other file" };
  added = [];
  (window as any).jarvis = {
    readNote: vi.fn(async (_ws: string, id: string) => files[id] ?? null),
    lineChanges: vi.fn(async () => ({ added, removedAfter: [] })),
  };
  // jsdom has no layout, so it ships no scrollTo
  Element.prototype.scrollTo = scrollTo as any;
  scrollTo.mockClear();
  container = document.createElement("div");
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => act(() => root.unmount()));

describe("Preview refresh", () => {
  it("re-reads the file and its markers when revision changes", async () => {
    show("a.ts", 0);
    await flush();
    expect(container.textContent).toContain("old text");

    files["a.ts"] = "new text";
    added = [3];
    show("a.ts", 1);
    await flush();
    expect(container.textContent).toContain("new text");
    expect(container.querySelector("pre")?.dataset.added).toBe("3");
  });

  it("keeps the scroll place on a re-read, and resets it for a new file", async () => {
    show("a.ts", 0);
    await flush();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    show("a.ts", 1);
    await flush();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    show("b.ts", 1);
    await flush();
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});
