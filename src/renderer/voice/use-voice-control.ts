// Wires tracker → dictation → the orchestrator's PTY. The microphone belongs
// to `micOn` (App state, persisted as Settings.voiceControl); a tracker
// failure surfaces as `error` and stops this session's microphone via
// onMicFailed — never by rewriting the user's setting.
import { useEffect, useRef, useState } from "react";
import { feed, finish, NO_DICTATION, type Dictation } from "./wake";
import { startVoiceTracker } from "./voice-tracker";

/** A dictation closes this long after the last utterance. Long enough to
 * think mid-sentence; short enough that you are not left wondering. */
export const END_MS = 2500;

export function useVoiceControl(opts: {
  micOn: boolean;
  targetId: string | null;
  micDeviceId?: string;
  onMicFailed: () => void;
}): { capturing: boolean; error: string | null } {
  const { micOn, targetId, micDeviceId, onMicFailed } = opts;
  const [speaking, setSpeaking] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // refs, not deps: a workspace switch must not tear down the microphone and
  // reload the model mid-sentence
  const targetRef = useRef(targetId);
  targetRef.current = targetId;
  const failedRef = useRef(onMicFailed);
  failedRef.current = onMicFailed;

  useEffect(() => {
    if (!micOn) {
      // the ear closes mid-dictation too — without these the glyph keeps
      // pulsing "listening" over an off button, and the capture gate that
      // keeps the mouth quiet stays open for the life of the mount
      setSpeaking(false);
      setDictating(false);
      return;
    }
    setError(null);
    setSpeaking(false);
    setDictating(false);
    let cancelled = false;
    let stop: (() => void) | null = null;
    let dictation: Dictation = NO_DICTATION;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const send = () => {
      timer = null;
      const command = finish(dictation);
      dictation = NO_DICTATION;
      setDictating(false);
      const id = targetRef.current;
      if (!command || !id) return;
      // no carriage return: dictation fills the composer and the human presses
      // Enter. A false wake costs a backspace, never a run.
      void window.jarvis.ptyInput(id, command).then((ok) => {
        // the orchestrator PTY exists only once its terminal panel has
        // launched one; a write into nothing must say so, not look sent
        if (!cancelled)
          setError(ok ? null : "no terminal open in that session");
      });
    };

    startVoiceTracker(
      ({ text }) => {
        dictation = feed(dictation, text);
        if (!dictation.active) return; // no wake word yet — nothing to hold
        setDictating(true);
        // every new breath pushes the deadline out, so a pause to think is
        // not the end of the sentence
        if (timer) clearTimeout(timer);
        timer = setTimeout(send, END_MS);
      },
      setSpeaking,
      micDeviceId,
    )
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        failedRef.current();
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stop?.();
    };
    // micDeviceId is a dep, not a ref, unlike targetId above: a device change
    // must reopen the stream. The whisper reload it costs is seconds, because
    // useBrowserCache is off — acceptable for an action taken by hand.
  }, [micOn, micDeviceId]);

  // an open dictation counts as capturing even between breaths — it is what
  // keeps the mouth quiet while you are still composing
  return { capturing: speaking || dictating, error };
}
