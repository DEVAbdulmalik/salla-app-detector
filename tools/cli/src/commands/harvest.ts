import { parseArgs } from "node:util";
import { harvestableApps, harvestReviewerStores, type AppHarvest } from "@salla-app-detector/jobs";
import { HostLimiter, SallaClient } from "@salla-app-detector/salla";
import { loadKnowledge, openDatabase } from "../context";

export const HARVEST_USAGE = `Usage: pnpm cli harvest [options]

Builds the corpus from app reviews. Every reviewer store is recorded as a known
installation of the app, and stores not scanned lately are scanned. The run is
paced, stops on its own if stores start refusing, and saves its place after
each app, so it can be interrupted and run again.

Options:
  --minutes <n>          stop after this long (default 15)
  --apps <n>             harvest at most this many apps
  --app <id>             harvest this app now, even if done recently (repeatable)
  --stores-per-app <n>   scanned stores to aim for per app (default 10)
`;

export async function harvestCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      minutes: { type: "string" },
      apps: { type: "string" },
      app: { type: "string", multiple: true },
      "stores-per-app": { type: "string" },
    },
  });

  const { database, repository } = openDatabase();
  try {
    const knowledge = await loadKnowledge(false);
    const listed = await repository.listedApps();
    const chosen = values.app ?? [];
    const apps =
      chosen.length > 0
        ? listed.filter((app) => chosen.includes(app.id))
        : harvestableApps(listed).slice(0, positive(values.apps) ?? listed.length);

    // Reviews, store lookups and product samples all go to Salla's API host, so the
    // limiter is what keeps a long run polite.
    const client = new SallaClient({
      timeoutMs: 20_000,
      limiter: new HostLimiter({ concurrency: 2, minIntervalMs: 500, maxWaitMs: 60_000 }),
    });
    const storesPerApp = positive(values["stores-per-app"]);

    let index = 0;
    const result = await harvestReviewerStores({
      repository,
      client,
      knowledge: knowledge.knowledge,
      apps,
      budgetMs: (positive(values.minutes) ?? 15) * 60 * 1000,
      ...(storesPerApp === undefined ? {} : { storesPerApp }),
      ...(chosen.length > 0 ? { revisitAfterDays: 0 } : {}),
      onApp: (harvest) => {
        index += 1;
        process.stdout.write(`${String(index).padStart(4)}  ${describe(harvest)}\n`);
      },
    });

    const scanned = Object.values(result.scanned).reduce((sum, count) => sum + count, 0);
    process.stdout.write(
      [
        "",
        `apps           ${String(result.apps.length)} this run, ${String(result.remaining)} still waiting`,
        `installations  ${String(result.groundTruth)} reviewer stores recorded`,
        `scanned        ${String(scanned)} stores${scanned === 0 ? "" : `: ${tally(result.scanned)}`}`,
        ...(result.stopped === "budget"
          ? ["stopped        time is up; run again to carry on"]
          : result.stopped === "refused"
            ? ["stopped        stores kept refusing; wait a while before the next run"]
            : []),
        "",
      ].join("\n"),
    );
    return result.stopped === "refused" ? 1 : 0;
  } finally {
    await database.close();
  }
}

function describe(harvest: AppHarvest): string {
  const name = `${harvest.name} (${harvest.appId})`;
  if (harvest.reviewsFailed !== undefined) {
    return `${name}  reviews unavailable (${harvest.reviewsFailed}), will retry`;
  }
  const scanned = tally(harvest.scanned);
  return (
    `${name}  ${String(harvest.reviewers)} reviewers, ${String(harvest.knownStores)} stores known, ` +
    `${String(harvest.alreadyScanned)} seen lately${scanned === "" ? "" : `, scanned ${scanned}`}`
  );
}

function tally(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .map(([status, count]) => `${String(count)} ${status}`)
    .join(", ");
}

function positive(value: string | undefined): number | undefined {
  const number = Number(value);
  return value !== undefined && Number.isFinite(number) && number > 0 ? number : undefined;
}
