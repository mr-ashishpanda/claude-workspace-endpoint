import { defineConfig, defaultExclude } from "vitest/config";

// Excludes vitest's usual defaults plus any local git worktree (isolated
// feature-branch checkouts can sit under the repo root and carry their own
// built dist/ and test files — without this, running the suite from the
// main checkout double-counts them).
export default defineConfig({
  test: {
    exclude: [...defaultExclude, ".worktrees/**", "worktrees/**"],
  },
});
