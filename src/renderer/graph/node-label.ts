import type { NodeDisplay } from "../session/highlight-store";
import { COLORS } from "./graph-colors";

// same label rule in both views: tags as #name, notes as their filename
export function nodeLabelText(id: string, type?: string): string {
  return type === "tag" ? id.replace(/^tag:/, "#") : id.split("/").pop() || id;
}

// the label follows the modified ring only; read, impact and search rings
// are transient and leave it plain
export function nodeLabelColor(display: NodeDisplay): string {
  return display === "modified" ? COLORS.modified : COLORS.label;
}
