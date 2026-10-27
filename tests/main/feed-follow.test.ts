import { describe, expect, it, vi } from "vitest";
import { feedStatusEvent } from "../../src/main/feed-follow";

const fakeFeed = () => ({ follow: vi.fn(), poke: vi.fn() });

describe("feedStatusEvent", () => {
  it("follows the transcript of a live session", () => {
    const feed = fakeFeed();
    feedStatusEvent(
      feed,
      { sessionKey: "k#1", transcriptPath: "t.jsonl", fromApp: true },
      true,
    );
    expect(feed.follow).toHaveBeenCalledWith("k#1", "t.jsonl");
    expect(feed.poke).not.toHaveBeenCalled();
  });

  it("pokes a live session whose event has no path", () => {
    const feed = fakeFeed();
    feedStatusEvent(feed, { sessionKey: "k#1", fromApp: true }, true);
    expect(feed.poke).toHaveBeenCalledWith("k#1");
    expect(feed.follow).not.toHaveBeenCalled();
  });

  it("ignores a claude started by hand in the same folder", () => {
    const feed = fakeFeed();
    feedStatusEvent(
      feed,
      { sessionKey: "k", transcriptPath: "hand.jsonl" },
      true,
    );
    expect(feed.follow).not.toHaveBeenCalled();
    expect(feed.poke).not.toHaveBeenCalled();
  });

  it("ignores events for a session with no live pty", () => {
    const feed = fakeFeed();
    feedStatusEvent(
      feed,
      { sessionKey: "k#1", transcriptPath: "t.jsonl" },
      false,
    );
    expect(feed.follow).not.toHaveBeenCalled();
    expect(feed.poke).not.toHaveBeenCalled();
  });
});
