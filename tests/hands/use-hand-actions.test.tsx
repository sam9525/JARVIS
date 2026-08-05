// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  useHandActions,
  type HandActions,
} from "../../src/renderer/hands/use-hand-actions";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = (el: React.ReactElement) => act(() => root.render(el));

function Host({
  label,
  refObj,
  calls,
}: {
  label: string;
  refObj: React.MutableRefObject<HandActions>;
  calls: string[];
}) {
  useHandActions(refObj, { open: () => calls.push(label) });
  return null;
}

describe("useHandActions", () => {
  it("registers during render and clears on unmount", () => {
    const refObj = { current: {} as HandActions };
    const calls: string[] = [];
    render(<Host label="a" refObj={refObj} calls={calls} />);
    refObj.current.open?.();
    expect(calls).toEqual(["a"]);
    render(<div />);
    expect(refObj.current.open).toBeUndefined();
  });

  it("a view switch never leaves the incoming view's map cleared", () => {
    const refObj = { current: {} as HandActions };
    const calls: string[] = [];
    render(<Host key="ring" label="ring" refObj={refObj} calls={calls} />);
    render(<Host key="fleet" label="fleet" refObj={refObj} calls={calls} />);
    refObj.current.open?.();
    expect(calls).toEqual(["fleet"]); // ring's cleanup must not have wiped fleet's map
  });

  it("re-registers each render so actions close over live state", () => {
    const refObj = { current: {} as HandActions };
    let seen = 0;
    function Counter({ n }: { n: number }) {
      useHandActions(refObj, { open: () => (seen = n) });
      return null;
    }
    render(<Counter n={1} />);
    render(<Counter n={2} />);
    refObj.current.open?.();
    expect(seen).toBe(2);
  });
});
