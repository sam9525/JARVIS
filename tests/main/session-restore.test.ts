import { describe, expect, it } from "vitest";
import {
  RESUME_WINDOW_MS,
  sessionsToResume,
} from "../../src/main/session-restore";

const SID = "0b5e6c1a-7f3d-4e2b-9a8c-1d2e3f4a5b6c";
const NOW = 1_800_000_000_000;
const saved = (closedAt: number) => ({ closedAt, sessions: { repo: SID } });

describe("sessionsToResume", () => {
  it("resumes inside the window, up to the hour itself", () => {
    expect(sessionsToResume(saved(NOW - 5 * 60_000), NOW)).toEqual({
      repo: SID,
    });
    expect(sessionsToResume(saved(NOW - RESUME_WINDOW_MS), NOW)).toEqual({
      repo: SID,
    });
  });

  it("starts fresh just outside the window", () => {
    expect(sessionsToResume(saved(NOW - RESUME_WINDOW_MS - 1), NOW)).toEqual(
      {},
    );
  });

  it("starts fresh with no stored state", () => {
    expect(sessionsToResume(null, NOW)).toEqual({});
    expect(sessionsToResume({ sessions: { repo: SID } }, NOW)).toEqual({});
  });

  it("does not trust a close time in the future", () => {
    expect(sessionsToResume(saved(NOW + 60_000), NOW)).toEqual({});
  });

  it("drops an id that is not a UUID", () => {
    const s = { closedAt: NOW, sessions: { a: "x & calc", b: SID, c: 3 } };
    expect(sessionsToResume(s, NOW)).toEqual({ b: SID });
  });
});
