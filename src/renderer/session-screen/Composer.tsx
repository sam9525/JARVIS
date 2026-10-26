import React, { useEffect, useRef, useState } from "react";
import type { TranscriptSummary } from "../../main/transcript-list";
import { relativeTime } from "../home/relative-time";
import {
  MODELS,
  atQuery,
  flipsToRaw,
  insertAt,
  matchFiles,
  pickerFor,
  sendPrompt,
} from "./composer-logic";
import { getDraft, onDraft, setDraft } from "./drafts";
import Picker, { type PickerItem } from "./Picker";
import { setViewMode } from "./view-mode";

type ComposerProps = {
  sessionKey: string;
  files: string[];
  currentModel: string;
  onError: (msg: string | null) => void;
};

const IMAGE_EXT: Record<string, "png" | "jpg" | "gif" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const KEY_HINTS: [string, string][] = [
  ["Enter", "send"],
  ["Shift+Enter", "new line"],
  ["Esc", "stop Claude"],
  ["Ctrl+V", "paste image"],
];

function highlight(path: string, query: string): React.ReactNode {
  const at = query ? path.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return path;
  return (
    <>
      {path.slice(0, at)}
      <b className="font-normal text-accent">
        {path.slice(at, at + query.length)}
      </b>
      {path.slice(at + query.length)}
    </>
  );
}

export default function Composer({
  sessionKey,
  files,
  currentModel,
  onError,
}: ComposerProps) {
  const [text, setText] = useState(() => getDraft(sessionKey));
  const [caret, setCaret] = useState(text.length);
  const [index, setIndex] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TranscriptSummary[]>([]);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    setText(getDraft(sessionKey));
    return onDraft((key) => {
      if (key === sessionKey) setText(getDraft(sessionKey));
    });
  }, [sessionKey]);

  // the caret can only move once the textarea holds the inserted text
  useEffect(() => {
    if (pendingCaret.current === null) return;
    const to = pendingCaret.current;
    pendingCaret.current = null;
    boxRef.current?.setSelectionRange(to, to);
    setCaret(to);
  }, [text]);

  const picker = closedFor === text ? null : pickerFor(text);
  useEffect(() => {
    if (picker !== "resume") return;
    let live = true;
    window.jarvis.listTranscripts(sessionKey).then((list) => {
      if (live) setSessions(list);
    });
    return () => {
      live = false;
    };
  }, [picker, sessionKey]);

  const at = picker || closedFor === text ? null : atQuery(text, caret);
  const matches = at ? matchFiles(files, at.query) : [];
  const popup = picker ? "picker" : matches.length > 0 ? "files" : null;

  const current = MODELS.find((m) => m.value === currentModel.toLowerCase());
  const pickerItems: PickerItem[] =
    picker === "model"
      ? MODELS.map((m) => ({
          id: m.value,
          label: m.label,
          note: m === current ? "current" : m.note,
          current: m === current,
        }))
      : picker === "resume"
        ? sessions.map((s) => ({
            id: s.sessionId,
            label: s.title || "untitled",
            note: `${relativeTime(s.mtime, Date.now())} · ${s.prompts} msgs`,
          }))
        : [];
  const itemCount = popup === "files" ? matches.length : pickerItems.length;

  function edit(next: string, nextCaret: number): void {
    setIndex(0);
    setClosedFor(null);
    setCaret(nextCaret);
    setDraft(sessionKey, next);
  }

  async function submit(prompt: string): Promise<void> {
    if (!prompt.trim()) return;
    const sent = await sendPrompt(sessionKey, prompt, window.jarvis.ptyInput);
    if (!sent) {
      onError("no terminal open in that session");
      return;
    }
    onError(null);
    if (flipsToRaw(prompt)) setViewMode(sessionKey, "raw", true);
    setDraft(sessionKey, "");
    setCaret(0);
  }

  function chooseFile(path: string): void {
    if (!at) return;
    const next = insertAt(text, at.start, caret, path);
    pendingCaret.current = next.caret;
    edit(next.text, next.caret);
  }

  function choosePicker(id: string): void {
    void submit(picker === "model" ? `/model ${id}` : `/resume ${id}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (popup && itemCount > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : itemCount - 1;
        setIndex((index + step) % itemCount);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault();
        if (popup === "files") chooseFile(matches[index]);
        else choosePicker(pickerItems[index].id);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (popup) setClosedFor(text);
      else void window.jarvis.ptyInput(sessionKey, "\x1b");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !popup) {
      e.preventDefault();
      void submit(text);
    }
  }

  async function onPaste(
    e: React.ClipboardEvent<HTMLTextAreaElement>,
  ): Promise<void> {
    const item = Array.from(e.clipboardData.items).find(
      (i) => i.kind === "file" && IMAGE_EXT[i.type],
    );
    const file = item?.getAsFile();
    if (!item || !file) return;
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end } = e.currentTarget;
    const path = await window.jarvis.savePastedImage(
      new Uint8Array(await file.arrayBuffer()),
      IMAGE_EXT[item.type],
    );
    const inserted = `${path} `;
    pendingCaret.current = start + inserted.length;
    edit(
      text.slice(0, start) + inserted + text.slice(end),
      pendingCaret.current,
    );
  }

  return (
    <div className="relative">
      {popup === "files" && (
        <Picker
          title="Files"
          activeIndex={index}
          onChoose={chooseFile}
          items={matches.map((p) => ({
            id: p,
            label: highlight(p, at?.query ?? ""),
            mono: true,
          }))}
        />
      )}
      {popup === "picker" && (
        <Picker
          title={
            picker === "model"
              ? "Switch model · sends /model <name>"
              : "Resume a session · sends /resume <id>"
          }
          activeIndex={index}
          onChoose={choosePicker}
          items={pickerItems}
        />
      )}
      <textarea
        ref={boxRef}
        value={text}
        rows={2}
        placeholder="Message Claude"
        onChange={(e) => edit(e.target.value, e.target.selectionStart)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className="block min-h-9 w-full resize-none border border-accent bg-transparent px-2.5 py-2 font-sans text-[12.5px] text-ink outline-none placeholder:text-ink-dim"
      />
      <div className="mt-1 flex flex-wrap gap-3">
        {KEY_HINTS.map(([key, label]) => (
          <span key={key} className="text-[10.5px] text-ink-dim">
            <kbd className="rounded-sm border border-edge px-1 font-mono text-[10px] text-ink-muted">
              {key}
            </kbd>{" "}
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
