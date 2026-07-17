import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // native module — must stay a runtime require, never bundled
      external: ["node-pty"],
    },
  },
});
