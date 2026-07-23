import React, { useState } from "react";
import { sendReply } from "./reply";

export default function ReplyBox({
  workspaceId,
  disabled,
}: {
  workspaceId: string | null;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!workspaceId) return;
    if (sendReply(workspaceId, text)) setText("");
  };
  return (
    <div className="flex items-center gap-2 border-t border-edge bg-panel px-2 py-2">
      <input
        className="min-w-0 flex-1 rounded-md border border-edge bg-black/30 px-3 py-1.5 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-40"
        placeholder={disabled ? "No live session" : "Reply to this session…"}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        className="flex-none rounded-md border border-edge px-3 py-1.5 text-[13px] text-ink-dim hover:border-accent hover:text-accent disabled:opacity-40"
        disabled={disabled}
        onClick={submit}
        title="Send reply"
      >
        ➤
      </button>
    </div>
  );
}
