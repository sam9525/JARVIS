import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ToolRow from "../../src/renderer/session-screen/ToolRow";

const edit = (result: object) => ({
  kind: "tool" as const,
  id: "t1",
  name: "Edit",
  input: { file_path: "src/main/edge-tts.ts" },
  result: { isError: false, text: "", ...result },
});

describe("ToolRow", () => {
  it("shows +2 −1 for an Edit patch", () => {
    const html = renderToStaticMarkup(
      <ToolRow item={edit({ patch: ["- a", "+ b", "+ c", "  ctx"] })} />,
    );
    expect(html).toContain("Edit(edge-tts.ts)");
    expect(html).toContain("+2 −1");
  });

  it("marks an error result", () => {
    const html = renderToStaticMarkup(
      <ToolRow item={edit({ isError: true, text: "boom" })} />,
    );
    expect(html).toContain('<span class="text-warm">●</span>');
  });
});
