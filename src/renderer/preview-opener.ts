import type { ToolEvent } from "../shared/types";

export const PREVIEW_QUIET_MS = 2500;

// Open the LAST file Claude read once reads go quiet — not every read.
// The app can't judge relevance (passive observer); last-before-quiet is
// the heuristic. A new prompt cancels any pending open and closes the
// preview left over from the previous question.
export function createPreviewOpener(
  open: (id: string | null) => void,
): (e: ToolEvent) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (e) => {
    if (e.tool === "Prompt") {
      clearTimeout(timer);
      open(null);
      return;
    }
    if (e.tool === "Read" && e.phase === "pre" && e.nodeIds[0]) {
      clearTimeout(timer);
      const id = e.nodeIds[0];
      timer = setTimeout(() => open(id), PREVIEW_QUIET_MS);
    }
  };
}
