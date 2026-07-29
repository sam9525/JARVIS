import { scanVault } from "../vault-graph";
import type { GraphSource } from "./types";

export const vaultSource: GraphSource = {
  id: "vault",
  detect: async (ws) => ws.kind === "vault",
  load: (ws) => scanVault(ws.rootPath),
};
