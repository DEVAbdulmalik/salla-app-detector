import { parseArgs } from "node:util";
import { scanStore } from "@salla-app-detector/jobs";
import type { CanaryStore } from "@salla-app-detector/knowledge";
import { SallaClient } from "@salla-app-detector/salla";
import { loadKnowledge, openDatabase } from "../context";

export const CANARY_USAGE = `Usage: pnpm cli canary [<store-url> ...] [options]

Keeps a small set of stores whose apps are known, so a fingerprint going stale
is noticed by the nightly health check rather than by a user.

Options:
  --list          print the current canaries and leave them alone
  --remove <url>  stop watching a store, such as one that has closed
  --from-scans <n>  take the n most recently scanned stores that had several
                  confirmed apps, instead of scanning the URLs given
`;

export async function canaryCommand(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      list: { type: "boolean", default: false },
      remove: { type: "string" },
      "from-scans": { type: "string" },
    },
  });

  const { database, repository } = openDatabase();
  try {
    if (values.list) {
      print(await repository.canaries());
      return 0;
    }

    if (values.remove !== undefined) {
      const removed = await repository.removeCanary(values.remove);
      process.stdout.write(
        removed
          ? `removed ${values.remove}
`
          : `not a canary: ${values.remove}
`,
      );
      return removed ? 0 : 1;
    }

    const fromScans = values["from-scans"];
    const canaries =
      fromScans === undefined
        ? await scanEach(positionals)
        : await fromRecentScans(repository, Number(fromScans));

    if (canaries.length === 0) {
      process.stdout.write(CANARY_USAGE);
      return 1;
    }

    await repository.upsertCanaries(canaries);
    print(canaries);
    return 0;
  } finally {
    await database.close();
  }
}

/** The expectation is what detection finds today; the alert is when it stops finding it. */
async function scanEach(urls: readonly string[]): Promise<CanaryStore[]> {
  if (urls.length === 0) {
    return [];
  }
  const knowledge = await loadKnowledge(false);
  const client = new SallaClient({ timeoutMs: 20_000 });
  const canaries: CanaryStore[] = [];

  for (const url of urls) {
    const result = await scanStore(url, { client, knowledge: knowledge.knowledge });
    if (!result.ok || result.value.report.status !== "live") {
      process.stderr.write(`skipped ${url}: not a live store\n`);
      continue;
    }
    const confirmed = result.value.report.apps
      .filter((app) => app.confidence === "confirmed")
      .map((app) => app.appId);
    if (confirmed.length === 0) {
      process.stderr.write(`skipped ${url}: nothing confirmed to watch\n`);
      continue;
    }
    canaries.push({
      // Keyed by origin: a store reached through /ar and through / is one canary.
      storeUrl: `https://${result.value.report.target.host}/`,
      expectedAppIds: confirmed,
      expectedServices: result.value.report.integrations.map((integration) => integration.key),
    });
  }
  return canaries;
}

async function fromRecentScans(
  repository: ReturnType<typeof openDatabase>["repository"],
  limit: number,
): Promise<CanaryStore[]> {
  const stores = await repository.storesWithConfirmedApps(Number.isFinite(limit) ? limit : 12);
  return stores.map((store) => ({
    storeUrl: `https://${store.storeKey}/`,
    expectedAppIds: store.appIds,
    expectedServices: [],
  }));
}

function print(canaries: readonly CanaryStore[]): void {
  for (const canary of canaries) {
    process.stdout.write(`${canary.storeUrl}  ${canary.expectedAppIds.join(", ")}\n`);
  }
  process.stdout.write(`${String(canaries.length)} canaries\n`);
}
