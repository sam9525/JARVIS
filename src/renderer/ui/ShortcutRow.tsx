import React from "react";
import { comboFromEvent, formatCombo, refusalReason } from "./key-combo";

interface Props {
  label: string;
  /** Prefix of the chip, record, reset and refusal test ids. */
  testId: string;
  /** The stored combo; undefined means the fallback is in use. */
  value: string | undefined;
  fallback: string;
  /** The other shortcut's current combo, which this one may not take. */
  taken: string;
  onChange: (combo: string | undefined) => void;
}

export default function ShortcutRow({
  label,
  testId,
  value,
  fallback,
  taken,
  onChange,
}: Props) {
  const current = value ?? fallback;
  const [recording, setRecording] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const record = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") {
      setRecording(false);
      return;
    }
    const combo = comboFromEvent(e.nativeEvent);
    if (combo === null) return;
    const reason = refusalReason(combo, taken);
    if (reason) {
      setRefusal(
        `Can't use ${formatCombo(combo)}: ${reason}. The key stays ${formatCombo(current)}.`,
      );
    } else {
      // the default is stored as absent, so "Default" stays disabled
      onChange(combo === fallback ? undefined : combo);
    }
    setRecording(false);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-t border-edge py-2 text-ink-muted">
        {label}
        <span
          data-testid={`${testId}-chip`}
          className={`rounded border bg-abyss px-1.5 py-0.5 font-mono text-[12px] ${
            recording ? "border-accent text-accent" : "border-edge text-ink"
          }`}
        >
          {recording ? "Press keys…" : formatCombo(current)}
        </span>
      </div>
      <div className="mb-1 flex gap-1.5">
        <button
          data-testid={`${testId}-record`}
          // only while recording: focus stays here afterwards, and App
          // skips every key pressed inside a recorder
          data-key-recorder={recording || undefined}
          className={`flex-1 cursor-pointer rounded-md py-1.5 transition-colors ${
            recording
              ? "border border-accent/35 bg-accent/15 text-accent"
              : "bg-edge text-ink hover:bg-edge/80"
          }`}
          onClick={(e) => {
            setRefusal(null);
            setRecording(true);
            e.currentTarget.focus();
          }}
          onKeyDown={recording ? record : undefined}
          onBlur={() => setRecording(false)}
        >
          {recording ? "Recording" : "Change"}
        </button>
        <button
          data-testid={`${testId}-reset`}
          className="flex-1 cursor-pointer rounded-md bg-edge py-1.5 text-ink transition-colors hover:bg-edge/80 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-edge"
          disabled={value === undefined}
          onClick={() => {
            setRefusal(null);
            onChange(undefined);
          }}
        >
          Default
        </button>
      </div>
      {recording && (
        <div className="pb-2 text-[11.5px] text-ink-dim">
          Hold Ctrl, Alt or Meta and press a key. Esc cancels.
        </div>
      )}
      {refusal && !recording && (
        <div
          data-testid={`${testId}-refusal`}
          className="pb-2 text-[11.5px] text-warm"
        >
          {refusal}
        </div>
      )}
    </>
  );
}
