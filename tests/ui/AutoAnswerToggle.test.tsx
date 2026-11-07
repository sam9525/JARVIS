import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AutoAnswerToggle from "../../src/renderer/ui/AutoAnswerToggle";

describe("AutoAnswerToggle", () => {
  it("shows A with aria-pressed false when off", () => {
    const html = renderToStaticMarkup(
      <AutoAnswerToggle on={false} onToggle={() => undefined} />,
    );
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">A<");
    expect(html).toContain('title="Answer questions automatically"');
    expect(html).not.toContain("AUTO ON");
  });

  it("shows AUTO ON with aria-pressed true when on", () => {
    const html = renderToStaticMarkup(
      <AutoAnswerToggle on onToggle={() => undefined} />,
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(">AUTO ON<");
    expect(html).toContain('title="Auto-answer is on, click to turn it off"');
  });

  it("a click calls onToggle", () => {
    const onToggle = vi.fn();
    const el = AutoAnswerToggle({ on: false, onToggle });
    el.props.onClick();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
