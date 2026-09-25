import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  exportKnowledge,
  importSeed,
  parseBackup,
  restoreKnowledge,
} from "@salla-app-detector/knowledge";
import { migrate } from "@salla-app-detector/knowledge/migrate";
import { openDatabase } from "../context";

export const DATABASE_USAGE = `Usage: pnpm cli db <migrate|import|snapshot|export|restore>

  migrate          apply pending migrations
  import           load the bundled knowledge into an empty database
  snapshot         show what the database currently knows
  export [dir]     save what people decided: curated fingerprints, noise,
                   review decisions, canaries and ground truth
  restore <file>   load such a backup back, after import and a catalogue sync
`;

/**
 * Backups land beside the repository, not in it: they are data, and a copy that lives in
 * the same place as the code is lost with it just as easily.
 */
const DEFAULT_BACKUP_DIR = resolve(process.cwd(), "..", "salla-app-detector-backups");

export async function databaseCommand(argv: readonly string[]): Promise<number> {
  const action = argv[0];
  if (
    action !== "migrate" &&
    action !== "import" &&
    action !== "snapshot" &&
    action !== "export" &&
    action !== "restore"
  ) {
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

    if (action === "export") {
      const directory = argv[1] === undefined ? DEFAULT_BACKUP_DIR : resolve(argv[1]);
      const backup = await exportKnowledge(repository);
      await mkdir(directory, { recursive: true });
      const file = join(
        directory,
        `knowledge-${backup.exportedAt.slice(0, 16).replace(":", "")}.json`,
      );
      await writeFile(file, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
      process.stdout.write(
        [
          `saved ${file}`,
          `  ${String(backup.fingerprints.length)} curated fingerprints, ${String(backup.noise.length)} noise rules,`,
          `  ${String(backup.candidates.length)} review decisions, ${String(backup.canaries.length)} canaries, ${String(backup.groundTruth.length)} ground truth pairs`,
          "",
        ].join("\n"),
      );
      return 0;
    }

    if (action === "restore") {
      const file = argv[1];
      if (file === undefined) {
        process.stdout.write(DATABASE_USAGE);
        return 1;
      }
      const backup = parseBackup(JSON.parse(await readFile(resolve(file), "utf8")));
      const summary = await restoreKnowledge(repository, backup);
      process.stdout.write(
        `restored ${String(summary.fingerprints)} fingerprints, ${String(summary.noise)} noise rules, ` +
          `${String(summary.candidates)} decisions, ${String(summary.canaries)} canaries, ` +
          `${String(summary.groundTruth)} ground truth pairs\n`,
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
