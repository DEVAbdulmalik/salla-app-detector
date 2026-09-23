import { learn } from "@salla-app-detector/jobs";
import { createLogger } from "@salla-app-detector/shared";
import { openDatabase } from "../context";

export const LEARN_USAGE = `Usage: pnpm cli learn

Clusters what scanning could not explain into candidates, records platform
background as noise, and flags integration keys that have no app behind them.
`;

export async function learnCommand(): Promise<number> {
  const { database, repository } = openDatabase();
  try {
    const result = await learn({
      repository,
      logger: createLogger({ level: "info", bindings: { job: "learn" } }),
    });

    process.stdout.write(
      [
        `candidates:  ${String(result.candidates)} (${String(result.attributed)} named automatically)`,
        `noise added: ${result.noiseRulesAdded.join(", ") || "none"}`,
        `new keys:    ${result.newServiceKeys.join(", ") || "none"}`,
        "",
      ].join("\n"),
    );
    return 0;
  } finally {
    await database.close();
  }
}
