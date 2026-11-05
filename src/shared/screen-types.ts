export type ScreenEntry =
  | { kind: "prompt"; id: string; text: string }
  | { kind: "text"; id: string; markdown: string }
  | { kind: "thinking"; id: string }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown> }
  | {
      kind: "result";
      toolUseId: string;
      isError: boolean;
      text: string;
      patch?: string[];
    }
  | {
      kind: "task";
      id: string;
      summary: string;
      failed: boolean;
      full: string;
    }
  | { kind: "notice"; id: string; text: string }
  | { kind: "unknown"; id: string; label: string };
