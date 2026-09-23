import { parseArgs } from "node:util";
import { validateCandidate } from "@salla-app-detector/jobs";
import { SallaClient } from "@salla-app-detector/salla";
import { createLogger } from "@salla-app-detector/shared";
import { openDatabase } from "../context";

export const VALIDATE_USAGE = `Usage: pnpm cli validate <signal-value> --app <app-id> [options]

Checks a proposed fingerprint against stores whose owners reviewed the app.

Options:
  --app <id>      the app the signal is believed to belong to (required)
  --kind <kind>   signal kind: domain (default), host, inline-token
  --stores <n>    how many reviewer stores to check (default 12)
`;

export async function validateCommand(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      app: { type: "string" },
      kind: { type: "string" },
      stores: { type: "string" },
    },
  });

  const signalValue = positionals[0];
  if (signalValue === undefined || values.app === undefined) {
    process.stdout.write(VALIDATE_USAGE);
    return 1;
  }

  const { database, repository } = openDatabase();
  try {
    const result = await validateCandidate({
      repository,
      client: new SallaClient({ timeoutMs: 20_000 }),
      appId: values.app,
      signalKind: values.kind ?? "domain",
      signalValue,
      logger: createLogger({ level: "info" }),
      ...(values.stores === undefined ? {} : { maxStores: Number(values.stores) }),
    });

    process.stdout.write(
      [
        `signal:   ${result.signalValue}`,
        `app:      ${result.appId}`,
        `stores:   ${String(result.storesWithSignal)} of ${String(result.storesChecked)} reviewer stores carry it`,
        `elsewhere: ${(result.baselineShare * 100).toFixed(1)}% of recently scanned stores`,
        `verdict:  ${result.verdict}`,
        "",
      ].join("\n"),
    );
    return result.verdict === "supported" ? 0 : 1;
  } finally {
    await database.close();
  }
}
