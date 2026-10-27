import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AskPrompt } from "../../main/ask-mapper";
import type { StatusKind } from "../../shared/types";
import { renderNote } from "../preview/markdown";
import AskPanel from "../ui/AskPanel";
import PermissionCard from "./PermissionCard";
import ToolRow from "./ToolRow";
import { isDrawn, openCalls, type ScreenItem } from "./screen-state";

export const KNOWN_GAPS = [
  "spinner and token counter",
  "background task panel",
  "API error banners",
];

const LIVE_LABEL: Partial<Record<StatusKind, string>> = {
  working: "working",
  asking: "asking you",
  blocked: "waiting on you",
};

// no vault to link into, so both link deps are dead ends
const NOTE_DEPS = { resolveLink: () => null, loadNote: async () => null };

function NoteText({ markdown }: { markdown: string }) {
  const [html, setHtml] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stale = false;
    setFailed(false);
    renderNote(markdown, NOTE_DEPS).then(
      (h) => !stale && setHtml(h),
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [markdown]);
  if (failed) {
    return (
      <div className="max-w-[92%] whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
        {markdown}
      </div>
    );
  }
  return (
    <div
      className="preview-body max-w-[92%] font-sans text-sm leading-relaxed text-ink"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Item({
  item,
  onShowRaw,
}: {
  item: ScreenItem;
  onShowRaw: () => void;
}) {
  switch (item.kind) {
    case "prompt":
      return (
        <div className="max-w-[80%] self-end whitespace-pre-wrap rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-sm text-ink">
          {item.text}
        </div>
      );
    case "text":
      return <NoteText markdown={item.markdown} />;
    case "thinking":
      return <div className="text-xs italic text-ink-dim">Thinking…</div>;
    case "notice":
      return <div className="text-xs text-ink-dim">{item.text}</div>;
    case "unknown":
      return (
        <div className="flex items-center gap-2 border border-dashed border-edge px-2 py-1 text-xs text-ink-dim">
          <span>{item.label} — not shown here</span>
          <button
            type="button"
            className="ml-auto cursor-pointer bg-transparent p-0 text-accent-soft"
            onClick={onShowRaw}
          >
            open raw terminal →
          </button>
        </div>
      );
    case "tool":
      return <ToolRow item={item} />;
  }
}

type SessionScreenProps = {
  sessionKey: string;
  items: ScreenItem[];
  status: { kind: StatusKind; call: string };
  ask?: AskPrompt;
  onAskAnswer: (writes: string[]) => void;
  onWrite: (data: string) => void;
  onShowRaw: () => void;
  footer: React.ReactNode;
};

export default function SessionScreen({
  sessionKey,
  items,
  status,
  ask,
  onAskAnswer,
  onWrite,
  onShowRaw,
  footer,
}: SessionScreenProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastTop = useRef(0);

  // A scroll event can be handled after newer output has already grown the
  // content, so the gap to the bottom alone would unpin a pinned stream.
  // Growth never moves scrollTop up; only the user scrolling up does.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
      pinned.current = true;
    } else if (el.scrollTop < lastTop.current) {
      pinned.current = false;
    }
    lastTop.current = el.scrollTop;
  };

  // Async-rendered text grows after the parent has rendered, so the pin
  // follows the content element's size, not React renders. A new session
  // remounts the scroller and starts pinned.
  useLayoutEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    pinned.current = true;
    lastTop.current = 0;
    const pin = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [sessionKey]);

  // A new prompt from any source (this composer, the raw terminal, a send
  // from the main agent) brings the stream back to the bottom and pins it.
  const lastPromptId = items.findLast((item) => item.kind === "prompt")?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !lastPromptId) return;
    pinned.current = true;
    el.scrollTop = el.scrollHeight;
  }, [lastPromptId]);

  const liveLabel = LIVE_LABEL[status.kind];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        key={sessionKey}
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div
          ref={content}
          className="flex flex-col gap-2.5 px-3.5 pb-1.5 pt-3.5"
        >
          {items.map((item, i) =>
            isDrawn(items, i, status.kind) ? (
              <Item key={item.id || i} item={item} onShowRaw={onShowRaw} />
            ) : null,
          )}
          {/* whatever the status: a Notification can move it off "asking"
              while the question is open, and the hook clears the ask when
              the tool ends */}
          {ask && (
            <div className="hud-glow-warm rounded-md border border-warm p-2">
              <AskPanel
                // a different question starts at its own first page
                key={`${ask.sessionKey}:${ask.ts}`}
                prompt={ask}
                workspaceName="Question"
                onAnswer={onAskAnswer}
              />
            </div>
          )}
          {status.kind === "blocked" && (
            <PermissionCard
              calls={openCalls(items)}
              onWrite={onWrite}
              onShowRaw={onShowRaw}
            />
          )}
        </div>
      </div>
      {liveLabel && (
        <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-1 font-mono text-xs text-accent">
          <i className="hud-breathe h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
          <span>
            {status.call ? `${liveLabel} · ${status.call}` : liveLabel}
          </span>
          <span
            className="cursor-help text-ink-dim"
            title={`Only in the raw terminal: ${KNOWN_GAPS.join(", ")}`}
          >
            ?
          </span>
        </div>
      )}
      <div className="border-t border-edge px-3 pb-2.5 pt-2">{footer}</div>
    </div>
  );
}
