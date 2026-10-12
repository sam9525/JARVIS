// node-pty's macOS prebuilds ship spawn-helper without its execute bit, and
// every pty spawn then dies with "posix_spawnp failed". npm does not restore
// it, so each install has to.
import { chmodSync, existsSync } from "node:fs";

for (const arch of ["darwin-arm64", "darwin-x64"]) {
  const helper = `node_modules/node-pty/prebuilds/${arch}/spawn-helper`;
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
