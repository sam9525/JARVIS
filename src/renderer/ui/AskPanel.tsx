import React, { useState } from "react";
import type { AskPrompt } from "../../main/ask-mapper";
import { LBL_CY, LBL_DIM } from "./hud";
import { docKindOf } from "./ask-doc";

type AskPanelProps = {
  prompt: AskPrompt;
  workspaceName: string;
  /** separate PTY writes, in order: a chunk arriving whole reads as a paste,
   *  so the keystrokes, any typed text and each Enter must not be merged */
  onAnswer: (writes: string[]) => void;
  /** opens a file node in the preview; never answers the question */
  onOpenDoc?: (nodeId: string) => void;
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

/** The question to show, from questions keyed by session key: this screen's
 *  own session first, else the newest open one in the fleet — a question must
 *  not hide behind the current view. `exclude` names a session whose question
 *  is already shown inline elsewhere. */
export function pickAsk(
  asks: Map<string, AskPrompt>,
  ownKey: string | undefined,
  exclude?: string,
): AskPrompt | undefined {
  const own =
    ownKey === undefined || ownKey === exclude ? undefined : asks.get(ownKey);
  return (
    own ??
    [...asks.values()]
      .filter((a) => a.sessionKey !== exclude)
      .sort((a, b) => b.ts - a.ts)[0]
  );
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
  onOpenDoc,
}: AskPanelProps) {
  // the panel's own index: the TUI moves to the next question as soon as one
  // is answered, and no event arrives until the whole tool completes
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState(false);
  const [typed, setTyped] = useState("");
  const q = prompt.questions[Math.min(index, prompt.questions.length - 1)];
  // multi-select needs a toggle key this design cannot verify, and a wrong
  // guess submits a partial answer
  const readOnly =
    q.multiSelect ||
    q.options.some((o) => o.label.trim().toLowerCase() === OTHER);

  // Claude Code lists the options, then its own "Type something." input row
  const rows = q.options.length + 1;
  const last = index >= prompt.questions.length - 1;
  // after the last of several questions the TUI shows a review screen whose
  // focused button is "Submit answers" — one more Enter confirms it
  const submit = last && prompt.questions.length > 1 ? ["\r"] : [];

  const send = (writes: string[]) => {
    onAnswer([...writes, "\r", ...submit]);
    setTyped("");
    setSent(true);
    if (!last) {
      setIndex(index + 1);
      setSent(false);
    }
  };
  const docKind = docKindOf(q.header);
  const docNodeId = docKind ? prompt.docs?.[docKind] : undefined;
  const answer = (i: number) => send([answerKeys(i, rows)]);
  const answerTyped = () => {
    const text = typed.replace(/[\r\n]+/g, " ").trim();
    if (text) send([answerKeys(q.options.length, rows), text]);
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
      {onOpenDoc && docKind && typeof docNodeId === "string" && (
        <button
          type="button"
          data-testid="ask-doc"
          onClick={() => onOpenDoc(docNodeId)}
          className="flex cursor-pointer items-center justify-between gap-3 border border-dashed border-accent/45 bg-transparent px-3 py-2 text-left transition-colors hover:border-solid hover:border-accent focus-visible:border-solid focus-visible:border-accent"
        >
          <span className="min-w-0">
            <span className="block text-[13px] text-accent-soft">
              {`Preview the ${docKind}`}
            </span>
            <span className="mt-0.5 block break-all text-[11px] text-ink-dim">
              {docNodeId}
            </span>
          </span>
          <span className={LBL_CY}>open ›</span>
        </button>
      )}
      {!readOnly && (
        <input
          data-testid="ask-typed"
          value={typed}
          placeholder="Type something."
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") answerTyped();
          }}
          className="border border-edge bg-transparent px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
        />
      )}
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
