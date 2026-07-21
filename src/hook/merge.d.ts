export function mergeHooks(
  settings: Record<string, unknown>,
  command: string,
): Record<string, unknown>;

export function stripHooks(
  settings: Record<string, unknown>,
): Record<string, unknown> | null;
