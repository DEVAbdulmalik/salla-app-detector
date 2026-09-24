import { parseArgs } from "node:util";
import { syncCatalog, syncThemes } from "@salla-app-detector/jobs";
import { SallaClient } from "@salla-app-detector/salla";
import { createLogger } from "@salla-app-detector/shared";
import { openDatabase } from "../context";

export const SYNC_USAGE = `Usage: pnpm cli sync <catalog|themes> [options]

Options (catalog):
  --details <n>   app details to refresh in this run (default 200)
  --budget <ms>   time budget before the run stops and saves its place (default 240000)
`;

export async function syncCommand(argv: readonly string[]): Promise<number> {
  if (argv[0] === "themes") {
    return syncThemesCommand();
  }
  if (argv[0] !== "catalog") {
    process.stdout.write(SYNC_USAGE);
    return argv[0] === undefined ? 0 : 1;
  }

  const { values } = parseArgs({
    args: [...argv.slice(1)],
    options: { details: { type: "string" }, budget: { type: "string" } },
  });

  const { database, repository } = openDatabase();
  try {
    const result = await syncCatalog({
      client: new SallaClient({ timeoutMs: 30_000 }),
      repository,
      logger: createLogger({ level: "info" }),
      ...(values.details === undefined ? {} : { detailsPerRun: Number(values.details) }),
      ...(values.budget === undefined ? {} : { budgetMs: Number(values.budget) }),
    });

    if (!result.ok) {
      process.stderr.write(`catalog sync failed: ${result.error.code}\n`);
      return 1;
    }

    const summary = result.value;
    process.stdout.write(
      [
        `catalogue: ${String(summary.catalogApps)} apps`,
        `details refreshed: ${String(summary.detailsFetched)} (${String(summary.detailsFailed)} unavailable)`,
        `newly delisted: ${String(summary.newlyDelisted.length)}`,
        `generated fingerprints: ${String(summary.fingerprintsWritten)} (removed ${String(summary.fingerprintsRemoved)})`,
        summary.completed ? "run complete" : "budget reached, more details pending",
        "",
      ].join("\n"),
    );
    return 0;
  } finally {
    await database.close();
  }
}

async function syncThemesCommand(): Promise<number> {
  const { database, repository } = openDatabase();
  try {
    const result = await syncThemes({
      client: new SallaClient({ timeoutMs: 30_000 }),
      repository,
      logger: createLogger({ level: "info" }),
    });

    if (!result.ok) {
      process.stderr.write(`theme sync failed: ${result.error.code}
`);
      return 1;
    }

    await repository.publishSnapshot();
    process.stdout.write(
      `themes: ${String(result.value.themes)} listed, ${String(result.value.delisted)} delisted
`,
    );
    return 0;
  } finally {
    await database.close();
  }
}
