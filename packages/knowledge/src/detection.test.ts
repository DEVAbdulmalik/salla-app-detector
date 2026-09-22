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
const timingIsMeaningful = process.env.COVERAGE_RUN !== "1";

const expectations = JSON.parse(
  readFileSync(join(FIXTURES, "expectations.json"), "utf8"),
) as Expectation[];

const knowledge = compileKnowledge(seedKnowledge);

function scan(expectation: Expectation): { report: ScanReport; durationMs: number } {
  const html = gunzipSync(readFileSync(join(FIXTURES, expectation.file))).toString("utf8");
  const host = expectation.file.replace(/\.html\.gz$/, "");
  const started = performance.now();
  const report = analyzeStore(
    {
      target: { url: `https://${host}/`, host },
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
      if (timingIsMeaningful) {
        expect(durationMs).toBeLessThan(BUDGET_MS);
      }
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

  it.skipIf(!timingIsMeaningful)("stays clear of the per-page time budget", () => {
    const durations = expectations.map((expectation) => scan(expectation).durationMs);
    const slowest = Math.max(...durations);

    expect(slowest).toBeLessThan(BUDGET_MS);
  });
});
