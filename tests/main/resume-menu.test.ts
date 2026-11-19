import { describe, expect, it } from "vitest";
import { resumeMenuLikely } from "../../src/main/resume-menu";

const NOW = Date.UTC(2026, 10, 16, 12, 0);
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const user = (m: number) =>
  JSON.stringify({ type: "user", timestamp: minsAgo(m), message: {} });
const assistant = (m: number, input: number) =>
  JSON.stringify({
    type: "assistant",
    timestamp: minsAgo(m),
    message: {
      usage: {
        input_tokens: input,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
      },
    },
  });

describe("resumeMenuLikely", () => {
  it("is likely for a large session last used 70 minutes ago", () => {
    const jsonl = [user(80), assistant(70, 100_000)].join("\n");
    expect(resumeMenuLikely(jsonl, NOW)).toBe(true);
  });

  it("is unlikely for a recent session", () => {
    const jsonl = [user(30), assistant(20, 500_000)].join("\n");
    expect(resumeMenuLikely(jsonl, NOW)).toBe(false);
  });

  it("is unlikely for a small session", () => {
    const jsonl = [user(300), assistant(200, 99_999)].join("\n");
    expect(resumeMenuLikely(jsonl, NOW)).toBe(false);
  });

  it("sums every usage field of the last assistant line", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: minsAgo(90),
      message: {
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 90_000,
          cache_creation_input_tokens: 9_990,
          output_tokens: 0,
        },
      },
    });
    expect(resumeMenuLikely(line, NOW)).toBe(true);
  });

  it("skips bookkeeping and broken lines", () => {
    const jsonl = [
      assistant(120, 200_000),
      JSON.stringify({ type: "system", timestamp: minsAgo(1) }),
      "{not json",
      "",
    ].join("\n");
    expect(resumeMenuLikely(jsonl, NOW)).toBe(true);
  });

  it("is unlikely for an empty transcript", () => {
    expect(resumeMenuLikely("", NOW)).toBe(false);
  });
});
