export interface PatchPaths {
  edited: string[];
  added: string[];
}

export function parsePatch(patch: unknown): PatchPaths {
  const edited: string[] = [];
  const added: string[] = [];
  if (typeof patch !== "string") return { edited, added };

  // A move replaces the path of the Update File line directly above it.
  let pendingUpdate: string | null = null;
  const push = (list: string[], path: string) => {
    if (path && !list.includes(path)) list.push(path);
  };

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("*** Add File:")) {
      push(added, line.slice("*** Add File:".length).trim());
      pendingUpdate = null;
    } else if (line.startsWith("*** Update File:")) {
      pendingUpdate = line.slice("*** Update File:".length).trim();
      push(edited, pendingUpdate);
    } else if (line.startsWith("*** Move to:")) {
      const target = line.slice("*** Move to:".length).trim();
      if (pendingUpdate !== null) {
        const at = edited.indexOf(pendingUpdate);
        if (at !== -1) edited.splice(at, 1);
        pendingUpdate = null;
      }
      push(edited, target);
    } else if (line.startsWith("*** ")) {
      pendingUpdate = null;
    }
  }
  return { edited, added };
}
