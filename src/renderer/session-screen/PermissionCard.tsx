import React from "react";
import { callSignature } from "../../shared/call-signature";
import { LBL_AM } from "../ui/hud";
import type { ScreenItem } from "./screen-state";

type ToolItem = Extract<ScreenItem, { kind: "tool" }>;

type PermissionCardProps = {
  calls: ToolItem[];
  onWrite: (data: string) => void;
  onShowRaw: () => void;
};

const BTN = "cursor-pointer border bg-transparent px-3 py-1 font-sans text-xs";

export default function PermissionCard({
  calls,
  onWrite,
  onShowRaw,
}: PermissionCardProps) {
  const single = calls.length === 1 ? calls[0] : null;
  return (
    <div className="hud-glow-warm flex flex-col gap-1.5 rounded-md border border-warm px-3 py-2.5">
      <span className={LBL_AM}>
        Permission{single ? ` · ${single.name}` : ""}
      </span>
      {calls.length === 0 && (
        <code className="font-mono text-xs text-ink">a tool call</code>
      )}
      {calls.map((c) => (
        <code
          key={c.id}
          className="break-all rounded-sm bg-abyss px-1.5 py-0.5 font-mono text-xs text-ink"
        >
          {callSignature(c.name, c.input)}
        </code>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        {single && (
          <>
            <button
              type="button"
              className={`${BTN} border-warm text-warm`}
              onClick={() => onWrite("\r")}
            >
              Yes
            </button>
            <button
              type="button"
              className={`${BTN} border-edge text-ink-muted`}
              onClick={() => onWrite("\x1b")}
            >
              No
            </button>
          </>
        )}
        <span className="ml-auto text-[11.5px] text-ink-dim">
          more options in the{" "}
          <button
            type="button"
            className="cursor-pointer bg-transparent p-0 text-accent-soft underline"
            onClick={onShowRaw}
          >
            raw terminal
          </button>
        </span>
      </div>
    </div>
  );
}
