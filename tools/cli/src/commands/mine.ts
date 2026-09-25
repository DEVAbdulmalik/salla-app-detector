import { parseArgs } from "node:util";
import { mineAppSignals, type AppMining, type MinedSignal } from "@salla-app-detector/jobs";
import { openDatabase } from "../context";

export const MINE_USAGE = `Usage: pnpm cli mine [options]

Compares the stores known to run each app with every other live store. Traces
most of an app's stores share and few others carry are filed as candidates with
their evidence; apps whose stores show nothing at all are marked traceless.
Reads only the database, so it can run as often as you like.

Options:
  --min-stores <n>   live stores an app needs before it is judged (default 5)
`;

const MARKS: Record<MinedSignal["standing"], string> = {
  new: "+ new   ",
  known: "= known ",
  shared: "~ shared",
};

export async function mineCommand(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { "min-stores": { type: "string" } },
  });
  const minStores = Number(values["min-stores"]);

  const { database, repository } = openDatabase();
  try {
    const [result, listed] = await Promise.all([
      mineAppSignals({
        repository,
        ...(Number.isInteger(minStores) && minStores > 0 ? { minStores } : {}),
      }),
      repository.listedApps(),
    ]);
    const names = new Map(listed.map((app) => [app.id, app.name]));
    const name = (id: string) => names.get(id) ?? id;

    for (const app of result.apps) {
      process.stdout.write(describe(app, name));
    }

    const verdicts = new Map<string, number>();
    for (const app of result.apps) {
      verdicts.set(app.verdict, (verdicts.get(app.verdict) ?? 0) + 1);
    }
    process.stdout.write(
      [
        "",
        `live stores   ${String(result.liveStores)}`,
        `apps judged   ${String(result.apps.length)}: ${[...verdicts].map(([verdict, count]) => `${String(count)} ${verdict}`).join(", ")}`,
        `candidates    ${String(result.candidates.length)} new traces filed for review`,
        "",
      ].join("\n"),
    );
    return 0;
  } finally {
    await database.close();
  }
}

function describe(app: AppMining, name: (id: string) => string): string {
  const lines = [
    `${name(app.appId)} (${app.appId})  ${String(app.detected)}/${String(app.stores)} detected, ${app.verdict}`,
    ...app.signals.map((signal) => {
      const shared =
        signal.sharedWith === undefined ? "" : `  with ${signal.sharedWith.map(name).join(", ")}`;
      return (
        `    ${MARKS[signal.standing]}  ${signal.kind} ${signal.value}  ` +
        `${String(signal.groupStores)}/${String(app.stores)} of its stores, ` +
        `${(signal.baselineShare * 100).toFixed(1)}% elsewhere${shared}`
      );
    }),
  ];
  return `${lines.join("\n")}\n`;
}
