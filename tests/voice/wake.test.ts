import { describe, it, expect } from "vitest";
import {
  WAKE_WORD,
  wakeIndex,
  commandAfterWake,
  feed,
  finish,
  NO_DICTATION,
} from "../../src/renderer/voice/wake";

describe("wakeIndex", () => {
  it("is null with no wake word", () => {
    expect(wakeIndex("open the pod bay doors")).toBe(null);
  });

  it("points just past the word", () => {
    expect(wakeIndex("jarvis")).toBe(6);
  });

  it("ignores case, because whisper capitalises a sentence start", () => {
    expect(wakeIndex("Jarvis, hello")).toBe(6);
  });

  it("needs a word boundary", () => {
    expect(wakeIndex("jarvistown is nice")).toBe(null);
  });

  it("takes the last wake word, so a restart wins", () => {
    expect(wakeIndex("jarvis no wait jarvis")).toBe(21);
  });
});

describe("commandAfterWake", () => {
  it("is null with no wake word", () => {
    expect(commandAfterWake("list the fleet")).toBe(null);
  });

  it("is null when the wake word stands alone", () => {
    expect(commandAfterWake("Jarvis.")).toBe(null);
  });

  it("returns the words after the wake word", () => {
    expect(commandAfterWake("Jarvis, list the fleet")).toBe("list the fleet");
  });

  it("drops leading punctuation and space", () => {
    expect(commandAfterWake("jarvis  -  run the tests")).toBe("run the tests");
  });

  it("keeps text before the wake word out of the command", () => {
    expect(commandAfterWake("um, ok jarvis run the tests")).toBe(
      "run the tests",
    );
  });

  it("collapses an embedded newline between the wake word and the rest", () => {
    expect(commandAfterWake("jarvis\nlist the fleet")).toBe("list the fleet");
  });

  it("collapses an embedded carriage return + newline", () => {
    expect(commandAfterWake("jarvis run\r\nthe tests")).toBe("run the tests");
  });

  it("collapses runs of ordinary spaces", () => {
    expect(commandAfterWake("jarvis    run   the   tests")).toBe(
      "run the tests",
    );
  });

  it("exports the word it looks for", () => {
    expect(WAKE_WORD).toBe("jarvis");
  });
});

describe("feed", () => {
  it("ignores everything until a wake word", () => {
    expect(feed(NO_DICTATION, "list the fleet")).toBe(NO_DICTATION);
  });

  it("opens on a bare wake word and waits for the command", () => {
    const d = feed(NO_DICTATION, "Jarvis.");
    expect(d.active).toBe(true);
    expect(finish(d)).toBe(null);
  });

  it("takes a command spoken in a LATER breath", () => {
    let d = feed(NO_DICTATION, "Jarvis.");
    d = feed(d, "list the fleet");
    expect(finish(d)).toBe("list the fleet");
  });

  it("joins as many breaths as you take", () => {
    let d = feed(NO_DICTATION, "jarvis");
    d = feed(d, "list the fleet");
    d = feed(d, "and say which are waiting");
    expect(finish(d)).toBe("list the fleet and say which are waiting");
  });

  it("takes a wake word and command in one breath too", () => {
    expect(finish(feed(NO_DICTATION, "Jarvis, list the fleet"))).toBe(
      "list the fleet",
    );
  });

  it("a second wake word throws away the false start", () => {
    let d = feed(NO_DICTATION, "jarvis run the wrong thing");
    d = feed(d, "no jarvis run the tests");
    expect(finish(d)).toBe("run the tests");
  });

  it("ignores an empty utterance without closing the dictation", () => {
    let d = feed(NO_DICTATION, "jarvis list the fleet");
    d = feed(d, "   ");
    expect(finish(d)).toBe("list the fleet");
    expect(d.active).toBe(true);
  });

  it("collapses a multi-line command accumulated across breaths into one line", () => {
    let d = feed(NO_DICTATION, "jarvis");
    d = feed(d, "list the fleet\nand say which are waiting");
    expect(finish(d)).toBe("list the fleet and say which are waiting");
  });
});

describe("finish", () => {
  it("is null when nothing is open", () => {
    expect(finish(NO_DICTATION)).toBe(null);
  });

  it("is null when only the wake word was said", () => {
    expect(finish({ active: true, text: "  " })).toBe(null);
  });
});
