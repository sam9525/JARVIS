import type { VaultGraph } from "../shared/types";

/** Serves the cached load for `id`, or starts one. A load that comes back
 * `failed` is dropped from the cache, so the next ask reads the index again. */
export function cachedGraph(
  cache: Map<string, Promise<VaultGraph>>,
  id: string,
  load: () => Promise<VaultGraph>,
): Promise<VaultGraph> {
  const hit = cache.get(id);
  if (hit) return hit;
  const g = load();
  cache.set(id, g);
  void g.then((r) => {
    // a rescan may have replaced the entry meanwhile; leave that one alone
    if (r.failed && cache.get(id) === g) cache.delete(id);
  });
  return g;
}
