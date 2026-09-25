import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // native modules — must stay a runtime require, never bundled.
      // ws requires bufferutil/utf-8-validate inside a try/catch to use them
      // if present; bundling hoists that require past the catch, so the
      // require must still throw at runtime for ws to fall back to its JS path.
      external: ["node-pty", "bufferutil", "utf-8-validate"],
    },
  },
});
