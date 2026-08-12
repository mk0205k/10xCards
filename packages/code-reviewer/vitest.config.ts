import { defineConfig } from "vitest/config";

/**
 * Unit-test config for the pure tool/render logic. Tests are co-located as
 * `*.test.ts` next to their sources under `src/`, matching the monorepo's
 * Vitest convention (`globals: true`, `environment: "node"`).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
