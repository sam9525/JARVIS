import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig(async () => {
  const tailwindcss = (await import("@tailwindcss/vite")).default;
  return {
    // "mpa", not the default "spa". The SPA fallback rewrites any unmatched
    // request to index.html with a 200, so a missing file under public/ is
    // served as HTML and fails much later, inside whatever parses it. "mpa"
    // keeps the middleware that serves the root index.html and drops only the
    // rewrite, so a miss 404s.
    //
    // Nothing routes client-side: no router, and view switching is
    // state-driven (Cards/Ring/Fleet through Segmented).
    appType: "mpa" as const,
    plugins: [tailwindcss()],
    build: {
      // The audio capture worklet must stay a real file. Under the 4 KB
      // default it inlines as a data: URL, and a data: URL is a script the
      // CSP's script-src 'self' will not run. Everything else keeps the
      // default.
      assetsInlineLimit: (file: string) =>
        file.endsWith("capture-worklet.js") ? false : undefined,
    },
  };
});
