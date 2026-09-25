import { parseArgs } from "node:util";
import type { Coverage, DetectedAppCoverage } from "@salla-app-detector/knowledge";
import { openDatabase } from "../context";

export const COVERAGE_USAGE = `Usage: pnpm cli coverage [--apps]

Shows how much of the catalogue detection has actually seen in stores, as opposed to
the apps that merely have a fingerprint.

Options:
  --apps   list every detected app with the number of stores it was found in
`;

/** The same threshold the learning loop uses before it proposes a candidate. */
const RECURRING_STORES = 5;

export async function coverageCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { apps: { type: "boolean", default: false } },
  });

  const { database, repository } = openDatabase();
  try {
    const coverage = await repository.coverage(RECURRING_STORES);
    process.stdout.write(summary(coverage));
    if (values.apps) {
      process.stdout.write(appList(coverage.detectedApps));
    }
    return 0;
  } finally {
    await database.close();
  }
}

function summary(coverage: Coverage): string {
  const listed = coverage.detectedApps.filter((app) => app.status === "listed");
  const outside = coverage.detectedApps.length - listed.length;
  const installs = listed.reduce((sum, app) => sum + (app.installs ?? 0), 0);
  const active = coverage.fingerprints.reduce((sum, row) => sum + row.active, 0);
  const matched = coverage.fingerprints.reduce((sum, row) => sum + row.matched, 0);
  const stores = coverage.corpus.reduce((sum, row) => sum + row.stores, 0);
  const beyond = outside === 0 ? "" : `; ${count(outside)} more outside the catalogue`;

  const lines = [
    `catalogue      ${count(coverage.listedApps)} listed apps, ${count(coverage.listedInstalls)} installs`,
    `on paper       ${count(coverage.fingerprintedApps)} apps have an active fingerprint (${share(coverage.fingerprintedApps, coverage.listedApps)})`,
    `detected       ${count(listed.length)} apps found in at least one live store (${share(listed.length, coverage.listedApps)}),`,
    `               covering ${share(installs, coverage.listedInstalls)} of installs${beyond}`,
    "",
    `fingerprints   ${count(matched)} of ${count(active)} active fingerprints have matched a page`,
    ...table(
      ["kind", "source", "active", "matched"],
      coverage.fingerprints.map((row) => [
        row.kind,
        row.source,
        count(row.active),
        count(row.matched),
      ]),
    ).map((line) => `               ${line}`),
    "",
    `corpus         ${count(stores)} stores: ${coverage.corpus.map((row) => `${count(row.stores)} ${row.status}`).join(", ")}`,
    `ground truth   ${count(coverage.groundTruth.pairs)} known installations across ${appCount(coverage.groundTruth.apps)}`,
    `unexplained    ${count(coverage.unexplained.traces)} traces, ${count(coverage.unexplained.recurring)} seen in ${String(RECURRING_STORES)} or more stores`,
    "",
  ];
  return lines.join("\n");
}

function appList(apps: readonly DetectedAppCoverage[]): string {
  const rows = apps.map((app) => [
    app.appId,
    app.name,
    count(app.stores),
    app.via.join("+"),
    app.status ?? "not in catalogue",
  ]);
  return [...table(["app", "name", "stores", "found on", "status"], rows), ""].join("\n");
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  return [header, ...rows].map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd(),
  );
}

function appCount(value: number): string {
  return `${count(value)} ${value === 1 ? "app" : "apps"}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

function share(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${((part / whole) * 100).toFixed(1)}%`;
}
