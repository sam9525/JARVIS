import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

// Dependencies Vite leaves external, so the packager must copy them whole.
const KEEP_DEPS = ["/node_modules/node-pty"];

const config: ForgeConfig = {
  packagerConfig: {
    // node-pty loads pty.node and spawns OpenConsole.exe / winpty-agent.exe by
    // real path — neither works from inside an archive.
    asar: { unpack: "**/node_modules/node-pty/**" },
    // Claude Code spawns the hook forwarder and the MCP server itself, so they
    // have to be real files beside the asar rather than entries inside it.
    extraResource: ["src/hook"],
    // Left unset, the Vite plugin ignores everything outside `.vite`, which
    // drops node-pty — the one dependency Vite leaves external and so the one
    // that must ship as a real package. An ancestor of a kept path stays
    // walkable, or the copy never descends far enough to reach it.
    ignore: (file: string) => {
      if (!file) return false;
      if (file.startsWith("/.vite")) return false;
      if (file.endsWith(".pdb")) return true; // 53 MB of debug symbols
      return !KEEP_DEPS.some(
        (d) =>
          file === d || file.startsWith(`${d}/`) || d.startsWith(`${file}/`),
      );
    },
  },
  // node-pty (the only native dep) is N-API with shipped prebuilds — rebuild
  // nothing; node-gyp would need a Windows SDK this machine doesn't have.
  rebuildConfig: { onlyModules: [] },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/main/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
