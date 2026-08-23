// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const tracker = vi.hoisted(() => ({
  onUtterance: null as null | ((c: { text: string }) => void),
  onSpeaking: null as null | ((on: boolean) => void),
  stop: vi.fn(),
  starts: 0,
  impl: null as null | (() => Promise<() => void>),
}));
vi.mock("../../src/renderer/voice/voice-tracker", () => ({
  startVoiceTracker: (
    onUtterance: (c: { text: string }) => void,
    onSpeaking: (on: boolean) => void,
  ) => {
    tracker.onUtterance = onUtterance;
    tracker.onSpeaking = onSpeaking;
    tracker.starts++;
    return tracker.impl
      ? tracker.impl()
      : Promise.reject(new Error("No microphone available"));
  },
}));

import {
  useVoiceControl,
  END_MS,
} from "../../src/renderer/voice/use-voice-control";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ptyInput = vi.fn(() => Promise.resolve(true));

function Host({
  micOn,
  targetId,
  onFail,
}: {
  micOn: boolean;
  targetId: string | null;
  onFail: () => void;
}) {
  const v = useVoiceControl({ micOn, targetId, onMicFailed: onFail });
  return (
    <div
      data-testid="probe"
      data-capturing={String(v.capturing)}
      data-error={v.error ?? ""}
    />
  );
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  tracker.onUtterance = null;
  tracker.onSpeaking = null;
  tracker.stop.mockClear();
  tracker.starts = 0;
  tracker.impl = null;
  ptyInput.mockClear();
  (window as any).jarvis = { ptyInput };
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const probe = () =>
  container.querySelector('[data-testid="probe"]') as HTMLElement;
const ok = () => {
  tracker.impl = () => Promise.resolve(tracker.stop);
};
const mount = (micOn: boolean, targetId: string | null = "ws-self") =>
  act(() => {
    root.render(
      <Host micOn={micOn} targetId={targetId} onFail={() => undefined} />,
    );
  });
const say = (text: string) => act(() => tracker.onUtterance!({ text }));
const pause = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("useVoiceControl", () => {
  it("does not start the microphone while off", async () => {
    ok();
    await act(async () => mount(false));
    expect(tracker.starts).toBe(0);
  });

  it("sends a wake word and command spoken in one breath", async () => {
    ok();
    await act(async () => mount(true));
    say("Jarvis, list the fleet");
    pause(END_MS);
    expect(ptyInput).toHaveBeenCalledWith("ws-self", "list the fleet");
  });

  it("waits through a pause and takes the command from a LATER breath", async () => {
    ok();
    await act(async () => mount(true));
    say("Jarvis.");
    pause(END_MS - 1);
    expect(ptyInput).not.toHaveBeenCalled();
    say("list the fleet");
    pause(END_MS - 1);
    expect(ptyInput).not.toHaveBeenCalled();
    say("and say which are waiting");
    pause(END_MS);
    expect(ptyInput).toHaveBeenCalledWith(
      "ws-self",
      "list the fleet and say which are waiting",
    );
  });

  it("sends once, not once per breath", async () => {
    ok();
    await act(async () => mount(true));
    say("jarvis one");
    say("two");
    pause(END_MS);
    expect(ptyInput).toHaveBeenCalledOnce();
  });

  it("never sends a carriage return, so nothing auto-runs", async () => {
    ok();
    await act(async () => mount(true));
    say("jarvis run the tests");
    pause(END_MS);
    expect(ptyInput.mock.calls[0][1]).not.toContain("\r");
    expect(ptyInput.mock.calls[0][1]).not.toContain("\n");
  });

  it("ignores speech with no wake word", async () => {
    ok();
    await act(async () => mount(true));
    say("list the fleet");
    pause(END_MS * 2);
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("sends nothing when only the wake word was said", async () => {
    ok();
    await act(async () => mount(true));
    say("Jarvis.");
    pause(END_MS);
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("a second wake word throws away the false start", async () => {
    ok();
    await act(async () => mount(true));
    say("jarvis delete everything");
    say("no jarvis run the tests");
    pause(END_MS);
    expect(ptyInput).toHaveBeenCalledWith("ws-self", "run the tests");
  });

  it("does not write when there is no orchestrator", async () => {
    ok();
    await act(async () => mount(true, null));
    say("jarvis do it");
    pause(END_MS);
    expect(ptyInput).not.toHaveBeenCalled();
  });

  it("captures while speech is live and while a dictation is open", async () => {
    ok();
    await act(async () => mount(true));
    expect(probe().dataset.capturing).toBe("false");
    act(() => tracker.onSpeaking!(true));
    expect(probe().dataset.capturing).toBe("true");
    act(() => tracker.onSpeaking!(false));
    say("jarvis");
    expect(probe().dataset.capturing).toBe("true"); // still waiting for you
    pause(END_MS);
    expect(probe().dataset.capturing).toBe("false");
  });

  it("surfaces a start failure and tells the caller to drop the mic", async () => {
    const onFail = vi.fn();
    await act(async () => {
      root.render(<Host micOn={true} targetId="ws-self" onFail={onFail} />);
    });
    expect(probe().dataset.error).toBe("No microphone available");
    expect(onFail).toHaveBeenCalledOnce();
  });

  it("stops the tracker when the microphone is turned off", async () => {
    ok();
    await act(async () => mount(true));
    await act(async () => mount(false));
    expect(tracker.stop).toHaveBeenCalledOnce();
  });

  it("stops claiming to listen when the mic goes off mid-dictation", async () => {
    ok();
    await act(async () => mount(true));
    say("jarvis");
    expect(probe().dataset.capturing).toBe("true");
    await act(async () => mount(false));
    // an off button that still pulses is the misreport the ✋ is forbidden
    expect(probe().dataset.capturing).toBe("false");
  });

  it("reports a command written into a session with no terminal", async () => {
    ok();
    ptyInput.mockResolvedValueOnce(false);
    await act(async () => mount(true));
    say("jarvis run the tests");
    await act(async () => {
      vi.advanceTimersByTime(END_MS);
      await Promise.resolve();
    });
    expect(probe().dataset.error).toContain("no terminal");
  });

  it("does not restart when only the target changes", async () => {
    ok();
    await act(async () => mount(true, "ws-a"));
    await act(async () => mount(true, "ws-b"));
    expect(tracker.starts).toBe(1);
    say("jarvis go");
    pause(END_MS);
    expect(ptyInput).toHaveBeenCalledWith("ws-b", "go");
  });
});
