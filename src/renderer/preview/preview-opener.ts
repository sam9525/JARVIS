import type { ToolEvent } from "../../shared/types";

export const PREVIEW_QUIET_MS = 2500;

export type PreviewOpener = ((e: ToolEvent) => void) & { cancel(): void };

// Open the LAST file Claude read once reads go quiet — not every read.
// A new prompt cancels any pending open and closes the leftover preview.
// cancel() exists for workspace switches: a pending open from the old
// workspace must not fire into the new one.
export function createPreviewOpener(
  open: (id: string | null) => void,
): PreviewOpener {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handler = ((e: ToolEvent) => {
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
  }) as PreviewOpener;
  handler.cancel = () => clearTimeout(timer);
  return handler;
}
