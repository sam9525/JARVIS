// same label rule in both views: tags as #name, notes as their filename
export function nodeLabelText(id: string, type?: string): string {
  return type === "tag" ? id.replace(/^tag:/, "#") : id.split("/").pop() || id;
}
