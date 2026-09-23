import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { recordScanOutcome, scanStore } from "@salla-app-detector/jobs";
import { HostLimiter, SallaClient } from "@salla-app-detector/salla";
import { loadKnowledge, openDatabase } from "../context";

export const CRAWL_USAGE = `Usage: pnpm cli crawl [<store-url> ...] [options]

Scans several stores and records each one, which is what feeds the learning
loop: matched fingerprints, the store's CDN code, and the unexplained signals.

Options:
  --file <path>     read one store URL per line
  --workers <n>     how many stores to scan at once (default 4)
`;

export async function crawlCommand(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { file: { type: "string" }, workers: { type: "string" } },
  });

  const urls = [...positionals, ...(await fromFile(values.file))];
  if (urls.length === 0) {
    process.stdout.write(CRAWL_USAGE);
    return 1;
  }

  const { database, repository } = openDatabase();
  try {
    const knowledge = await loadKnowledge(false);
    // Stores without a domain of their own all answer on one host, so a wide crawl lands
    // on the platform as a burst unless it is paced.
    const client = new SallaClient({
      timeoutMs: 20_000,
      limiter: new HostLimiter({ concurrency: 2, minIntervalMs: 500, maxWaitMs: 60_000 }),
    });
    const queue = [...urls];
    const tally = { live: 0, other: 0, failed: 0 };

    const worker = async (): Promise<void> => {
      for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
        const startedAt = Date.now();
        const result = await scanStore(url, { client, knowledge: knowledge.knowledge });

        if (!result.ok) {
          tally.failed += 1;
          process.stdout.write(`${url.padEnd(42)} ${result.error.code}\n`);
          continue;
        }

        const { report } = result.value;
        await recordScanOutcome(repository, report, Date.now() - startedAt);
        if (report.status === "live") {
          tally.live += 1;
        } else {
          tally.other += 1;
        }
        process.stdout.write(
          `${report.target.key.padEnd(42)} ${report.status.padEnd(12)} ` +
            `${String(report.apps.length)} apps, ${String(report.unknownSignals.length)} unknown\n`,
        );
      }
    };

    const workers = Math.max(1, Math.min(8, Number(values.workers ?? 4)));
    await Promise.all(Array.from({ length: workers }, () => worker()));

    process.stdout.write(
      `\n${String(tally.live)} live, ${String(tally.other)} other, ${String(tally.failed)} failed\n`,
    );
    return 0;
  } finally {
    await database.close();
  }
}

async function fromFile(path: string | undefined): Promise<string[]> {
  if (path === undefined) {
    return [];
  }
  const contents = await readFile(path, "utf8");
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}
