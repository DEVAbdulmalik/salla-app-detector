import { defineConfig } from "vitest/config";

// Coverage instrumentation slows execution by an order of magnitude, which would make any
// timing assertion meaningless. Tests read this flag and skip those checks.
const underCoverage = process.argv.includes("--coverage");

export default defineConfig({
  test: {
    include: ["{packages,apps,tools}/*/src/**/*.test.ts"],
    env: { COVERAGE_RUN: underCoverage ? "1" : "0" },
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
