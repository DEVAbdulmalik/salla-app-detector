import { DATABASE_USAGE, databaseCommand } from "./commands/database";
import { SCAN_USAGE, scanCommand } from "./commands/scan";
import { SYNC_USAGE, syncCommand } from "./commands/sync";
import { loadEnvironment } from "./context";

const USAGE = `Usage: pnpm cli <command>

  scan <store-url>   detect the apps a store uses
  db <action>        manage the knowledge database
  sync catalog       refresh the app catalogue from Salla

${SCAN_USAGE}
${DATABASE_USAGE}
${SYNC_USAGE}`;

async function main(argv: readonly string[]): Promise<number> {
  loadEnvironment();
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
      process.stdout.write(USAGE);
      return 0;
    case "scan":
      return scanCommand(rest);
    case "db":
      return databaseCommand(rest);
    case "sync":
      return syncCommand(rest);
    default:
      process.stdout.write(USAGE);
      return command === "--help" ? 0 : 1;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
