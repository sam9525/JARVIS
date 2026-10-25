export const MAIN_LABEL = "main";
export const MAX_SESSIONS = 4;

const LABEL_MAX_LENGTH = 20;
const KEY_SEPARATOR = "#";

export function sessionKey(workspaceId: string, label: string): string {
  return label === MAIN_LABEL
    ? workspaceId
    : `${workspaceId}${KEY_SEPARATOR}${label}`;
}

/**
 * Callers that know the workspace list must pass it: a workspace id may hold
 * a `#` itself, and a bare key matching one of those ids is its main session.
 */
export function parseSessionKey(
  key: string,
  workspaceIds: Iterable<string> = [],
): {
  workspaceId: string;
  label: string;
} {
  if (new Set(workspaceIds).has(key))
    return { workspaceId: key, label: MAIN_LABEL };
  const separatorAt = key.lastIndexOf(KEY_SEPARATOR);
  if (separatorAt === -1) return { workspaceId: key, label: MAIN_LABEL };
  return {
    workspaceId: key.slice(0, separatorAt),
    label: key.slice(separatorAt + 1),
  };
}

export function cleanLabel(raw: string): string {
  return raw
    .replace(/[^A-Za-z0-9 -]/g, "-")
    .trim()
    .slice(0, LABEL_MAX_LENGTH)
    .trimEnd();
}

const ORDER_WORDS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

export function nextLabel(taken: string[], folders: string[]): string {
  const unavailable = new Set([...taken, ...folders]);
  const freeWord = ORDER_WORDS.find((word) => !unavailable.has(word));
  if (freeWord !== undefined) return freeWord;
  let candidate = 1;
  while (unavailable.has(String(candidate))) candidate += 1;
  return String(candidate);
}
