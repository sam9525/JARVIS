/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-empty-function */
import { vi, describe, it, expect } from "vitest";
import Timeline from "../../src/renderer/session/Timeline";
import type { ToolEvent } from "../../src/shared/types";

let currentTree: any = null;

function render(el: any) {
  currentTree = typeof el.type === "function" ? el.type(el.props) : el;
}

function walk(node: any, fn: (n: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walk(item, fn);
      if (found) return found;
    }
    return null;
  }
  if (fn(node)) return node;
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = walk(child, fn);
      if (found) return found;
    }
  } else if (children && typeof children === "object") {
    return walk(children, fn);
  }
  return null;
}

function text(node: any): string {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}

function byTestId(id: string) {
  const found = walk(currentTree, (n) => n.props?.["data-testid"] === id);
  if (!found) throw new Error(`${id} not found`);
  return { text: text(found), props: found.props };
}

const ev = (over: Partial<ToolEvent>): ToolEvent => ({
  sessionId: "s1",
  workspaceId: "w1",
  phase: "pre",
  tool: "Read",
  nodeIds: [],
  ts: 0,
  ...over,
});

const LOG: ToolEvent[] = [
  ev({ tool: "Prompt" }),
  ev({ nodeIds: ["a"] }),
  ev({ nodeIds: ["b"] }),
  ev({ nodeIds: ["c"] }),
];

describe("Timeline", () => {
  it("renders nothing for an empty log", () => {
    render(<Timeline log={[]} index={null} onScrub={() => {}} />);
    expect(currentTree).toBeNull();
  });

  it("parks at the last event and labels it when live", () => {
    render(<Timeline log={LOG} index={null} onScrub={() => {}} />);
    expect(byTestId("replay-range").props.value).toBe(3);
    expect(byTestId("replay-label").text).toContain("Read c");
    expect(byTestId("replay-position").text).toBe("4 / 4");
  });

  it("labels the event it is scrubbed to", () => {
    render(<Timeline log={LOG} index={0} onScrub={() => {}} />);
    expect(byTestId("replay-label").text).toContain("— your message —");
    expect(byTestId("replay-position").text).toBe("1 / 4");
  });

  it("emits the index when scrubbed back", () => {
    const onScrub = vi.fn();
    render(<Timeline log={LOG} index={null} onScrub={onScrub} />);
    byTestId("replay-range").props.onChange({ target: { value: "1" } });
    expect(onScrub).toHaveBeenCalledWith(1);
  });

  it("emits null when scrubbed to the end — live is a position", () => {
    const onScrub = vi.fn();
    render(<Timeline log={LOG} index={1} onScrub={onScrub} />);
    byTestId("replay-range").props.onChange({ target: { value: "3" } });
    expect(onScrub).toHaveBeenCalledWith(null);
  });

  it("the Live button returns to live and is disabled when already live", () => {
    const onScrub = vi.fn();
    render(<Timeline log={LOG} index={1} onScrub={onScrub} />);
    expect(byTestId("replay-live").props.disabled).toBe(false);
    byTestId("replay-live").props.onClick();
    expect(onScrub).toHaveBeenCalledWith(null);

    render(<Timeline log={LOG} index={null} onScrub={onScrub} />);
    expect(byTestId("replay-live").props.disabled).toBe(true);
  });

  it("places a chapter tick at each prompt", () => {
    render(<Timeline log={LOG} index={null} onScrub={() => {}} />);
    const ticks = byTestId("replay-chapters").props.children;
    expect(ticks.length).toBe(1);
    expect(ticks[0].props.style.left).toBe("0%");
  });

  it("clamps an index past the end of the log", () => {
    render(<Timeline log={LOG} index={99} onScrub={() => {}} />);
    expect(byTestId("replay-position").text).toBe("4 / 4");
  });

  it("survives a single-event log without dividing by zero", () => {
    render(
      <Timeline
        log={[ev({ tool: "Prompt" })]}
        index={null}
        onScrub={() => {}}
      />,
    );
    expect(byTestId("replay-position").text).toBe("1 / 1");
    expect(byTestId("replay-chapters").props.children[0].props.style.left).toBe(
      "0%",
    );
  });
});
