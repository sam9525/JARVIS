// The node/link shapes react-force-graph hands back to accessors, shared by
// the 2D and 3D views. Both live on the same objects; only 3D reads `z`.
export type NodeObj = {
  id?: string | number;
  type?: string;
  domain?: string;
  file?: string;
  r?: number;
  x?: number;
  y?: number;
  z?: number;
};

export type LinkEnd = string | number | NodeObj;
export type LinkObj = { source?: LinkEnd; target?: LinkEnd };

// links hold node objects after graph init but raw ids before it
export function endId(end: LinkEnd | undefined): string {
  return typeof end === "object" && end !== null ? String(end.id) : String(end);
}
