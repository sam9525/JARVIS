import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // a session worktree holds a half-finished copy of these tests
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});
