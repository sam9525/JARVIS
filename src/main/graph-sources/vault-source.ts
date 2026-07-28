import { scanVault } from "../vault-graph";
import { SOURCE_LABELS } from "../../shared/types";
import type { GraphSource } from "./types";

export const vaultSource: GraphSource = {
  id: "vault",
  label: SOURCE_LABELS.vault,
  detect: async (ws) => ws.kind === "vault",
  load: (ws) => scanVault(ws.rootPath),
};
