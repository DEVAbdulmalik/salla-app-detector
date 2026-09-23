import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeStore, compileKnowledge, type ScanReport } from "@salla-app-detector/engine";
import { describe, expect, it } from "vitest";
import { seedKnowledge } from "./index";

/**
 * Detection is checked against real storefronts captured from live stores, so a change to
 * a fingerprint, to the noise rules, or to the engine shows up as a concrete difference in
 * what a scan reports rather than as a passing unit test.
 */
interface Expectation {
  readonly file: string;
  readonly httpStatus: number;
  readonly status: ScanReport["status"];
  readonly storeId?: number;
  readonly apps: readonly string[];
  readonly dropshipping: readonly string[];
  readonly integrations: readonly string[];
}

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const BUDGET_MS = 50;
const MEDIAN_BUDGET_MS = 25;
/**
 * A ceiling far above the budget. It is what the ordinary test run asserts, because that
 * run happens on whatever machine a developer has, doing whatever else it is doing: a
 * scheduler hiccup must not read as a regression. Crossing this still means something
 * structural changed, such as a fingerprint index rebuilt for every page.
 */
const CEILING_MS = 250;
const timingIsMeaningful = process.env.COVERAGE_RUN !== "1";
/** The budget itself is asserted where the machine is dedicated to the run. */
const holdToBudget = process.env.BENCH === "1";

const expectations = JSON.parse(
  readFileSync(join(FIXTURES, "expectations.json"), "utf8"),
) as Expectation[];

const knowledge = compileKnowledge(seedKnowledge);

function measure(): { median: number; p95: number } {
  const durations = expectations
    .map((expectation) => scan(expectation).durationMs)
    .sort((left, right) => left - right);
  return {
    median: durations[Math.floor(durations.length / 2)] ?? 0,
    p95: durations[Math.floor(durations.length * 0.95)] ?? 0,
  };
}

function scan(expectation: Expectation): { report: ScanReport; durationMs: number } {
  const html = gunzipSync(readFileSync(join(FIXTURES, expectation.file))).toString("utf8");
  const host = expectation.file.replace(/\.html\.gz$/, "");
  const started = performance.now();
  const report = analyzeStore(
    {
      target: { url: `https://${host}/`, host, key: host },
      page: { status: expectation.httpStatus, finalUrl: `https://${host}/`, html },
    },
    knowledge,
  );
  return { report, durationMs: performance.now() - started };
}

describe("detection against captured storefronts", () => {
  it("covers every outcome a scan has to handle", () => {
    const statuses = new Set(expectations.map((expectation) => expectation.status));

    expect(statuses).toContain("live");
    expect(statuses).toContain("maintenance");
    expect(statuses).toContain("not-salla");
    expect(expectations.length).toBeGreaterThan(40);
  });

  it.each(expectations.map((expectation) => [expectation.file, expectation] as const))(
    "%s",
    (_file, expectation) => {
      const { report, durationMs } = scan(expectation);

      expect(report.status).toBe(expectation.status);
      expect(report.store?.id).toBe(expectation.storeId);
      expect(report.apps.map((app) => app.appId).sort()).toEqual([...expectation.apps]);
      expect(report.dropshipping.map((app) => app.appId).sort()).toEqual([
        ...expectation.dropshipping,
      ]);
      expect(report.integrations.map((integration) => integration.key).sort()).toEqual([
        ...expectation.integrations,
      ]);
      expect(durationMs).toBeGreaterThan(0);
    },
  );

  it("backs every detection with evidence", () => {
    for (const expectation of expectations) {
      const { report } = scan(expectation);
      for (const app of [...report.apps, ...report.dropshipping]) {
        expect(app.evidence.length, `${expectation.file} / ${app.appId}`).toBeGreaterThan(0);
      }
    }
  });

  it("reports the preinstalled app as such, and names the rest", () => {
    const live = expectations.filter((expectation) => expectation.status === "live");
    const reports = live.map((expectation) => scan(expectation).report);

    const preinstalled = reports.flatMap((report) =>
      report.apps.filter((app) => app.appId === "691365818"),
    );
    expect(preinstalled.length).toBeGreaterThan(0);
    expect(preinstalled.every((app) => app.isDefault)).toBe(true);

    const named = reports.flatMap((report) =>
      report.apps.filter((app) => app.status === "listed" && app.name !== app.appId),
    );
    expect(named.length).toBeGreaterThan(0);
  });

  it.skipIf(!timingIsMeaningful)("analyses a page well inside its time budget", () => {
    // One pass to warm up, because the first page also pays for JIT and module loading.
    for (const expectation of expectations) {
      scan(expectation);
    }

    // The question is how fast the engine can parse a page, not what else the machine was
    // doing at that moment, so the fastest pass is the honest one: a real regression is
    // slower in every pass, while a busy core only spoils some of them.
    const passes = [measure(), measure(), measure()];
    const median = Math.min(...passes.map((pass) => pass.median));
    const p95 = Math.min(...passes.map((pass) => pass.p95));

    process.stdout.write(
      `    page analysis: median ${median.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms
`,
    );

    expect(p95).toBeLessThan(CEILING_MS);
    if (holdToBudget) {
      expect(median).toBeLessThan(MEDIAN_BUDGET_MS);
      expect(p95).toBeLessThan(BUDGET_MS);
    }
  });
});
