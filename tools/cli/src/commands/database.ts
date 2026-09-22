import { importSeed } from "@salla-app-detector/knowledge";
import { migrate } from "@salla-app-detector/knowledge/migrate";
import { openDatabase } from "../context";

export const DATABASE_USAGE = `Usage: pnpm cli db <migrate|import|snapshot>

  migrate    apply pending migrations
  import     load the bundled knowledge into an empty database
  snapshot   show what the database currently knows
`;

export async function databaseCommand(argv: readonly string[]): Promise<number> {
  const action = argv[0];
  if (action !== "migrate" && action !== "import" && action !== "snapshot") {
    process.stdout.write(DATABASE_USAGE);
    return action === undefined ? 0 : 1;
  }

  const { database, repository } = openDatabase();
  try {
    if (action === "migrate") {
      const result = await migrate(database);
      process.stdout.write(
        result.applied.length === 0
          ? "schema is up to date\n"
          : `applied: ${result.applied.join(", ")}\n`,
      );
      return 0;
    }

    if (action === "import") {
      const summary = await importSeed(repository);
      process.stdout.write(
        `imported ${String(summary.apps)} apps, ${String(summary.fingerprints)} fingerprints, ${String(summary.noiseRules)} noise rules\n`,
      );
      return 0;
    }

    const snapshot = await repository.loadSnapshot();
    const byStatus = countBy(Object.values(snapshot.apps).map((app) => app.status));
    const byKind = countBy(snapshot.fingerprints.map((fingerprint) => fingerprint.kind));
    process.stdout.write(
      [
        `version: ${snapshot.version}`,
        `apps: ${String(Object.keys(snapshot.apps).length)} (${describe(byStatus)})`,
        `fingerprints: ${String(snapshot.fingerprints.length)} (${describe(byKind)})`,
        `noise rules: ${String(Object.values(snapshot.noise).flat().length)}`,
        "",
      ].join("\n"),
    );
    return 0;
  } finally {
    await database.close();
  }
}

function countBy(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function describe(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => `${key} ${String(count)}`)
    .join(", ");
}
