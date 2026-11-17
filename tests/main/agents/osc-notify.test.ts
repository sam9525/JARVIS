import { describe, expect, it } from "vitest";
import {
  createOscScanner,
  OSC_BUFFER_CAP,
} from "../../../src/main/agents/osc-notify";

const E = "\x1b";
const B = "\x07";

describe("createOscScanner", () => {
  it("reports the text of an OSC 9 sequence ended by BEL", () => {
    const s = createOscScanner();
    expect(
      s.feed("a", `x${B}${E}]9;Antigravity CLI needs tool confirmation${B}y`),
    ).toEqual(["Antigravity CLI needs tool confirmation"]);
  });

  it("accepts the ESC \\ terminator and reports two sequences in one chunk", () => {
    const s = createOscScanner();
    expect(s.feed("a", `${E}]9;one${E}\\${E}]9;two${B}`)).toEqual([
      "one",
      "two",
    ]);
  });

  it("joins a sequence split across chunks", () => {
    const s = createOscScanner();
    expect(s.feed("a", `${E}]9;Antigravity CLI is re`)).toEqual([]);
    expect(s.feed("a", `ady for input${B}`)).toEqual([
      "Antigravity CLI is ready for input",
    ]);
  });

  it("joins a sequence split inside the introducer", () => {
    const s = createOscScanner();
    expect(s.feed("a", `${E}`)).toEqual([]);
    expect(s.feed("a", `]9;late${B}`)).toEqual(["late"]);
  });

  it("ignores other OSC numbers", () => {
    const s = createOscScanner();
    expect(s.feed("a", `${E}]0;title${B}${E}]7501;?${B}`)).toEqual([]);
  });

  it("drops an unfinished sequence longer than the cap", () => {
    const s = createOscScanner();
    expect(OSC_BUFFER_CAP).toBe(256);
    expect(s.feed("b", `${E}]9;` + "z".repeat(300))).toEqual([]);
    expect(s.feed("b", `tail${B}${E}]9;next${B}`)).toEqual(["next"]);
  });

  it("forgets a session's unfinished sequence", () => {
    const s = createOscScanner();
    s.feed("c", `${E}]9;half`);
    s.forget("c");
    expect(s.feed("c", `done${B}`)).toEqual([]);
  });

  it("keeps one buffer per session", () => {
    const s = createOscScanner();
    expect(s.feed("a", `${E}]9;x`)).toEqual([]);
    expect(s.feed("d", `y${B}`)).toEqual([]);
  });

  it("runs the brief's sequence on one scanner", () => {
    const s = createOscScanner();
    expect(
      s.feed("a", `x${B}${E}]9;Antigravity CLI needs tool confirmation${B}y`),
    ).toEqual(["Antigravity CLI needs tool confirmation"]);
    expect(s.feed("a", `${E}]9;one${E}\\${E}]9;two${B}`)).toEqual([
      "one",
      "two",
    ]);
    expect(s.feed("a", `${E}]9;Antigravity CLI is re`)).toEqual([]);
    expect(s.feed("a", `ady for input${B}`)).toEqual([
      "Antigravity CLI is ready for input",
    ]);
    expect(s.feed("a", `${E}`)).toEqual([]);
    expect(s.feed("a", `]9;late${B}`)).toEqual(["late"]);
    expect(s.feed("a", `${E}]0;title${B}${E}]7501;?${B}`)).toEqual([]);
    expect(s.feed("b", `${E}]9;` + "z".repeat(300))).toEqual([]);
    expect(s.feed("b", `tail${B}${E}]9;next${B}`)).toEqual(["next"]);
    s.feed("c", `${E}]9;half`);
    s.forget("c");
    expect(s.feed("c", `done${B}`)).toEqual([]);
    expect(s.feed("a", `${E}]9;x`)).toEqual([]);
    expect(s.feed("d", `y${B}`)).toEqual([]);
  });
});
