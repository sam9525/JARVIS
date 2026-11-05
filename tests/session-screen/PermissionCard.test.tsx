import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PermissionCard from "../../src/renderer/session-screen/PermissionCard";

const call = (id: string, command: string) => ({
  kind: "tool" as const,
  id,
  name: "Bash",
  input: { command },
});
const noop = vi.fn();
const render = (calls: ReturnType<typeof call>[]) =>
  renderToStaticMarkup(
    <PermissionCard calls={calls} onWrite={noop} onShowRaw={noop} />,
  );

describe("PermissionCard", () => {
  it("one call shows Yes and No", () => {
    const html = render([call("a", "npm test")]);
    expect(html).toContain("Bash(npm test)");
    expect(html).toContain(">Yes<");
    expect(html).toContain(">No<");
  });

  it("two calls show the list without buttons", () => {
    const html = render([call("a", "npm test"), call("b", "ls")]);
    expect(html).toContain("Bash(npm test)");
    expect(html).toContain("Bash(ls)");
    expect(html).not.toContain(">Yes<");
  });

  it("always shows the raw terminal hint", () => {
    const sets = [[], [call("a", "ls")], [call("a", "ls"), call("b", "pwd")]];
    for (const calls of sets) {
      expect(render(calls)).toContain("more options in the");
    }
  });
});
