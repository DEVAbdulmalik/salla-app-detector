import { health, sallaContracts } from "@salla-app-detector/jobs";
import { SallaClient } from "@salla-app-detector/salla";
import { createLogger } from "@salla-app-detector/shared";
import { loadKnowledge, openDatabase } from "../context";

export const HEALTH_USAGE = `Usage: pnpm cli health

Runs the checks the nightly job runs: the canary stores, the share of scans
ending in a block, and fingerprints that stopped matching.
`;

export async function healthCommand(): Promise<number> {
  const { database, repository } = openDatabase();
  try {
    const knowledge = await loadKnowledge(false);
    const client = new SallaClient({ timeoutMs: 20_000 });
    const result = await health({
      repository,
      client,
      contracts: sallaContracts(client),
      knowledge: knowledge.knowledge,
      logger: createLogger({ level: "info", bindings: { job: "health" } }),
    });

    for (const outcome of result.outcomes) {
      const state = outcome.unreachable
        ? "unreachable"
        : outcome.missingAppIds.length === 0
          ? "ok"
          : `missing ${outcome.missingAppIds.join(", ")}`;
      process.stdout.write(`${outcome.storeUrl.padEnd(40)} ${state}\n`);
    }
    for (const event of result.events) {
      process.stdout.write(`[${event.severity}] ${event.kind} ${JSON.stringify(event.detail)}\n`);
    }
    process.stdout.write(
      `${String(result.canariesIntact)} of ${String(result.canariesChecked)} canaries intact\n`,
    );

    return result.events.some((event) => event.severity === "critical") ? 1 : 0;
  } finally {
    await database.close();
  }
}
