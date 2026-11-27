import { defineConfig } from "vitest/config";

export default defineConfig({
  // File-backed stores fsync on every write; Windows runners are slow enough to pass the 5 s default.
  test: { include: ["test/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 30_000 },
});
