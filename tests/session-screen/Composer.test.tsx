import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Composer from "../../src/renderer/session-screen/Composer";

describe("Composer", () => {
  it("shows the input box and no key hints", () => {
    const html = renderToStaticMarkup(
      <Composer sessionKey="k" files={[]} currentModel="" onError={vi.fn()} />,
    );
    expect(html).toContain("<textarea");
    expect(html).not.toContain("<kbd");
    expect(html).not.toContain("stop Claude");
  });
});
