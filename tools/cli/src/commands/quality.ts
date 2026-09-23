import { parseArgs } from "node:util";
import { scanStore } from "@salla-app-detector/jobs";
import { SallaClient } from "@salla-app-detector/salla";
import { loadKnowledge, openDatabase } from "../context";

export const QUALITY_USAGE = `Usage: pnpm cli quality-report [options]

Scans the stores we know run a given app and reports how often detection
finds it. Recall is measured against ground truth collected from reviews.

Options:
  --limit <n>   how many ground truth pairs to check (default 40)
`;

interface Tally {
  checked: number;
  detected: number;
  confirmed: number;
  unreachable: number;
  missed: string[];
}

export async function qualityCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { limit: { type: "string" } },
  });

  const { database, repository } = openDatabase();
  try {
    const knowledge = await loadKnowledge(false);
    const client = new SallaClient({ timeoutMs: 20_000 });
    const rows = await repository.groundTruth(Number(values.limit ?? 40));
    const tally: Tally = { checked: 0, detected: 0, confirmed: 0, unreachable: 0, missed: [] };

    for (const row of rows) {
      const url = await client.resolveStoreUrl(Number(row.storeId));
      if (!url.ok) {
        tally.unreachable += 1;
        continue;
      }
      const result = await scanStore(url.value, { client, knowledge: knowledge.knowledge });
      if (!result.ok || result.value.report.status !== "live") {
        tally.unreachable += 1;
        continue;
      }

      tally.checked += 1;
      const found = result.value.report.apps.find((app) => app.appId === row.appId);
      if (found === undefined) {
        tally.missed.push(`${row.appName} @ ${url.value}`);
        continue;
      }
      tally.detected += 1;
      if (found.confidence === "confirmed") {
        tally.confirmed += 1;
      }
    }

    const recall = tally.checked === 0 ? 0 : tally.detected / tally.checked;
    process.stdout.write(
      [
        `knowledge:   ${knowledge.knowledge.snapshot.version}`,
        `pairs:       ${String(rows.length)} known installations`,
        `checked:     ${String(tally.checked)} (${String(tally.unreachable)} stores unreachable)`,
        `detected:    ${String(tally.detected)}, of which ${String(tally.confirmed)} confirmed`,
        `recall:      ${(recall * 100).toFixed(1)}%`,
        "",
      ].join("\n"),
    );
    for (const missed of tally.missed) {
      process.stdout.write(`missed: ${missed}\n`);
    }

    return 0;
  } finally {
    await database.close();
  }
}
