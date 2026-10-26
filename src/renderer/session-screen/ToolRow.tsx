import React, { useState } from "react";
import { callSignature } from "../../shared/call-signature";
import { patchCounts, type ScreenItem } from "./screen-state";

type ToolItem = Extract<ScreenItem, { kind: "tool" }>;

// the one new raw pair: added and removed diff lines
const DIFF_ADD = "text-[#7ee2a8]";
const DIFF_DEL = "text-[#ff8f8f]";

function lineTone(line: string): string {
  if (line.startsWith("+")) return DIFF_ADD;
  if (line.startsWith("-")) return DIFF_DEL;
  return "text-ink-dim";
}

export default function ToolRow({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const { result } = item;
  const patch = result?.patch;
  const counts = patch ? patchCounts(patch) : null;
  const expandable = Boolean(patch || result?.text);
  const counted = counts ? `+${counts.added} −${counts.removed} ` : "";

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full min-w-0 items-center gap-2 border-l-2 bg-transparent px-2 py-0.5 text-left font-mono text-xs text-ink-muted ${
          result ? "border-edge" : "border-accent"
        } ${expandable ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className={result?.isError ? "text-warm" : "text-accent"}>●</span>
        <span className="min-w-0 truncate">
          {callSignature(item.name, item.input)}
        </span>
        {expandable && (
          <span className="ml-auto whitespace-nowrap text-ink-dim">
            {counted}
            {open ? "▴" : "▾"}
          </span>
        )}
      </button>
      {open && patch && (
        <pre className="ml-2.5 mt-1 overflow-x-auto rounded-md border border-edge bg-abyss px-2 py-1.5 font-mono text-[11.5px] leading-normal">
          {patch.map((line, i) => (
            <div key={i} className={lineTone(line)}>
              {line}
            </div>
          ))}
        </pre>
      )}
      {open && !patch && result?.text && (
        <pre className="ml-2.5 mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-edge bg-abyss px-2 py-1.5 font-mono text-[11.5px] leading-normal text-ink-muted">
          {result.text}
        </pre>
      )}
    </div>
  );
}
