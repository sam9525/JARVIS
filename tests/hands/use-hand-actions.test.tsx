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

  // App holds the workspace map but stays mounted on the home screen, where a
  // view owns the map instead. A disabled caller has to stay silent there:
  // writing an empty map would clobber the owner, undone only if that owner
  // re-renders in the same pass.
  it("a disabled caller neither registers nor clobbers the owner", () => {
    const refObj = { current: {} as HandActions };
    const calls: string[] = [];
    function Disabled() {
      useHandActions(refObj, { open: () => calls.push("parent") }, false);
      return null;
    }
    // the disabled caller renders AFTER the owner, so an unconditional write
    // would land on top of the owner's map
    render(
      <>
        <Host label="view" refObj={refObj} calls={calls} />
        <Disabled />
      </>,
    );
    refObj.current.open?.();
    expect(calls).toEqual(["view"]);
  });

  it("a disabled caller owns nothing, so its unmount clears nothing", () => {
    const refObj = { current: {} as HandActions };
    const calls: string[] = [];
    function Parent() {
      useHandActions(refObj, { open: () => calls.push("parent") }, false);
      return null;
    }
    render(<Host label="view" refObj={refObj} calls={calls} />);
    render(<Parent />); // view unmounts, disabled parent takes its place
    render(<div />);
    expect(refObj.current.open).toBeUndefined();
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
