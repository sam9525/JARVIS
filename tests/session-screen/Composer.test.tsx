import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Composer from "../../src/renderer/session-screen/Composer";

describe("Composer", () => {
  it("shows the key hints", () => {
    const html = renderToStaticMarkup(
      <Composer sessionKey="k" files={[]} currentModel="" onError={vi.fn()} />,
    );
    expect(html).toContain("Enter");
    expect(html).toContain("Shift+Enter");
    expect(html).toContain("new line");
    expect(html).toContain("stop Claude");
    expect(html).toContain("paste image");
    expect(html).toContain("<textarea");
  });
});
