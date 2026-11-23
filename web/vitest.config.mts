import { defineConfig } from "vitest/config";

/**
 * Unit tests for web/'s decision logic (the gate roll-up, risk and session
 * rules, the wording guardrail, ...). Pure code only: no database, network
 * or AI calls. Run with `npm test -w @edge/web`; CI runs them on every PR.
 */
export default defineConfig({
  // "@/lib/..." imports, from tsconfig.json
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
