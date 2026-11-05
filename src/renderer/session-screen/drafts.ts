const drafts = new Map<string, string>();
const listeners = new Set<(key: string) => void>();

export function getDraft(key: string): string {
  return drafts.get(key) ?? "";
}

export function setDraft(key: string, text: string): void {
  drafts.set(key, text);
  for (const l of listeners) l(key);
}

export function clearDraft(key: string): void {
  if (!drafts.has(key)) return;
  drafts.delete(key);
  for (const l of listeners) l(key);
}

export function appendDraft(key: string, text: string): void {
  const current = getDraft(key);
  setDraft(key, current ? `${current} ${text}` : text);
}

export function onDraft(fn: (key: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
