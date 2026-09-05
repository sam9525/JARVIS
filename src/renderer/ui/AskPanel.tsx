import React, { useState } from "react";
import type { AskPrompt } from "../../main/ask-mapper";
import { LBL_DIM } from "./hud";

type AskPanelProps = {
  prompt: AskPrompt;
  workspaceName: string;
  /** the keystrokes that move the TUI's cursor onto the clicked option */
  onAnswer: (keys: string) => void;
};

/**
 * Up to the top, then down to the option. The ups are what make the sequence
 * safe: the panel cannot see where the TUI's cursor sits, and a picker the
 * user already arrowed around in is not on option 0. A list that clamps at
 * the top lands on it; a list that wraps returns to where it was, which is
 * the position the downs alone would have assumed anyway.
 */
export function answerKeys(index: number, options: number): string {
  return "\x1b[A".repeat(options) + "\x1b[B".repeat(index);
}

// Claude Code appends this itself, and it needs typed prose rather than a
// keystroke — so its presence makes the whole question read-only.
const OTHER = "other";

/**
 * The question, its options, and one standing hint. Clicking is the
 * convenience; showing the question is most of the value, which is why a
 * shape we cannot drive safely still renders in full.
 */
export default function AskPanel({
  prompt,
  workspaceName,
  onAnswer,
}: AskPanelProps) {
  // the panel's own index: the TUI moves to the next question as soon as one
  // is answered, and no event arrives until the whole tool completes
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState(false);
  const q = prompt.questions[Math.min(index, prompt.questions.length - 1)];
  // multi-select needs a toggle key this design cannot verify, and a wrong
  // guess submits a partial answer
  const readOnly =
    q.multiSelect ||
    q.options.some((o) => o.label.trim().toLowerCase() === OTHER);

  const answer = (i: number) => {
    onAnswer(answerKeys(i, q.options.length));
    setSent(true);
    if (index < prompt.questions.length - 1) {
      setIndex(index + 1);
      setSent(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className={LBL_DIM}>{q.header || workspaceName}</div>
      <p
        data-testid="ask-question"
        className="m-0 text-[14px] leading-snug text-ink"
      >
        {q.question}
      </p>
      <div className="flex flex-col gap-1.5">
        {q.options.map((o, i) => (
          <div
            key={o.label + i}
            data-testid={`ask-option-${i}`}
            title={o.description || o.label}
            onClick={readOnly ? undefined : () => answer(i)}
            className={
              "border border-edge px-3 py-2 " +
              (readOnly
                ? ""
                : "cursor-pointer transition-colors hover:border-accent")
            }
          >
            <div className="text-[13px] text-ink">{o.label}</div>
            {o.description && (
              <div className="mt-0.5 text-[11px] text-ink-dim">
                {o.description}
              </div>
            )}
          </div>
        ))}
      </div>
      <div
        data-testid="ask-foot"
        className={
          LBL_DIM +
          " mt-auto flex justify-between gap-3 border-t border-edge pt-2"
        }
      >
        <span>
          {prompt.questions.length > 1
            ? `Question ${index + 1} of ${prompt.questions.length}`
            : ""}
        </span>
        {/* the standing hint is not decoration: it is what makes a
            mis-driven TUI recoverable */}
        <span>
          {readOnly
            ? "answer this one in the terminal"
            : sent
              ? "sent — waiting for Claude"
              : "or answer in the terminal"}
        </span>
      </div>
    </div>
  );
}
