import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StatusLine from "../../src/renderer/session-screen/StatusLine";
import type { StatusLineView } from "../../src/shared/types";

const NOW = 1_000_000_000_000;
const view: StatusLineView = {
  model: "Opus 5.5",
  effort: "high",
  folder: "JARVIS",
  branch: "develop",
  commit: "feat: offer a label on jarvis_send for fresh sessions",
  contextPct: 38,
  fiveHourPct: 63,
  fiveHourResetsAt: NOW / 1000 + (3 * 60 + 12) * 60,
  sevenDayPct: 84,
  sevenDayResetsAt: NOW / 1000 + (2 * 1440 + 5 * 60) * 60,
};
const html = renderToStaticMarkup(<StatusLine view={view} now={NOW} />);

describe("StatusLine", () => {
  it("renders three rows with the mockup values", () => {
    for (const s of [
      "Opus 5.5",
      "high",
      "JARVIS",
      "develop",
      "38%",
      "63%",
      "↻3h12m",
      "84%",
      "↻2d5h",
      "⬆ feat: offer a label",
    ]) {
      expect(html).toContain(s);
    }
  });

  it("uses warm at 63% and hot at 84%", () => {
    expect(html.match(/shadow-\[0_0_6px/g)).toHaveLength(1);
    expect(html.match(/bg-warm/g)).toHaveLength(2);
  });

  it("renders nothing without data", () => {
    expect(renderToStaticMarkup(<StatusLine view={null} now={NOW} />)).toBe("");
  });

  it("has no LAST COMMIT label", () => {
    expect(html.toLowerCase()).not.toContain("last commit");
  });
});
