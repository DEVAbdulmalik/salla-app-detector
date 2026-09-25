import { parseArgs } from "node:util";
import { ignoreCandidate, promoteCandidate } from "@salla-app-detector/jobs";
import { openDatabase } from "../context";

export const CANDIDATES_USAGE = `Usage: pnpm cli candidates [<command>] [options]

  (no command)                    list what is waiting for a decision
  promote <signal> --app <id>     turn it into a fingerprint scanning will use
  ignore <signal>                 record the decision so it stops coming back

Options:
  --kind <kind>       signal kind when a value appears under more than one (default domain)
  --strength <level>  decisive, strong or medium (default strong)
  --status <status>   which list to show: new, promoted, ignored (default new)
`;

export async function candidatesCommand(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      app: { type: "string" },
      kind: { type: "string" },
      strength: { type: "string" },
      status: { type: "string" },
    },
  });

  const [command, signalValue] = positionals;
  const { database, repository } = openDatabase();

  try {
    if (command === undefined) {
      return await list(repository, values.status ?? "new");
    }

    if (signalValue === undefined) {
      process.stdout.write(CANDIDATES_USAGE);
      return 1;
    }

    const kind = values.kind ?? "domain";

    if (command === "ignore") {
      await ignoreCandidate(repository, kind, signalValue);
      process.stdout.write(`ignored ${signalValue}\n`);
      return 0;
    }

    if (command === "promote") {
      const result = await promoteCandidate(repository, {
        signalKind: kind,
        signalValue,
        appId: values.app ?? "",
        ...(values.strength === undefined
          ? {}
          : { strength: values.strength as "decisive" | "strong" | "medium" }),
      });
      if (!result.ok) {
        process.stderr.write(`cannot promote: ${result.error}\n`);
        return 1;
      }
      process.stdout.write(`promoted ${signalValue} to app ${values.app ?? ""}\n`);
      return 0;
    }

    process.stdout.write(CANDIDATES_USAGE);
    return 1;
  } finally {
    await database.close();
  }
}

async function list(
  repository: ReturnType<typeof openDatabase>["repository"],
  status: string,
): Promise<number> {
  const rows = await repository.listCandidates(status, 60);
  if (rows.length === 0) {
    process.stdout.write("nothing waiting\n");
    return 0;
  }

  for (const row of rows) {
    const note =
      row.themeName !== undefined
        ? `theme: ${row.themeName}`
        : (row.suggestedAppName ?? row.suggestedAppId ?? "");
    process.stdout.write(
      `${String(row.storeCount).padStart(3)}  ${row.signalKind.padEnd(17)} ` +
        `${row.signalValue.slice(0, 44).padEnd(46)} ${note}\n`,
    );
    if (row.sample !== undefined) {
      process.stdout.write(`     ${row.sample.slice(0, 96)}\n`);
    }
  }
  process.stdout.write(`\n${String(rows.length)} waiting\n`);
  return 0;
}
