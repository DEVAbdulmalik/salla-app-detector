import { DATABASE_USAGE, databaseCommand } from "./commands/database";
import { SCAN_USAGE, scanCommand } from "./commands/scan";
import { CANARY_USAGE, canaryCommand } from "./commands/canary";
import { CANDIDATES_USAGE, candidatesCommand } from "./commands/candidates";
import { COVERAGE_USAGE, coverageCommand } from "./commands/coverage";
import { CRAWL_USAGE, crawlCommand } from "./commands/crawl";
import { HEALTH_USAGE, healthCommand } from "./commands/health";
import { LEARN_USAGE, learnCommand } from "./commands/learn";
import { QUALITY_USAGE, qualityCommand } from "./commands/quality";
import { SYNC_USAGE, syncCommand } from "./commands/sync";
import { VALIDATE_USAGE, validateCommand } from "./commands/validate";
import { loadEnvironment } from "./context";

const USAGE = `Usage: pnpm cli <command>

  scan <store-url>   detect the apps a store uses
  db <action>        manage the knowledge database
  sync catalog       refresh the app catalogue from Salla
  validate <signal>  check a proposed fingerprint against reviewer stores
  canary             manage the stores the health check watches
  crawl              scan several stores and record what they show
  health             run the monitoring checks now
  learn              turn unexplained signals into candidates
  candidates         review what learning proposed, and decide
  quality-report     measure detection against known installations
  coverage           how much of the catalogue detection has actually seen

${SCAN_USAGE}
${DATABASE_USAGE}
${SYNC_USAGE}
${VALIDATE_USAGE}
${CANARY_USAGE}
${CRAWL_USAGE}
${HEALTH_USAGE}
${LEARN_USAGE}
${CANDIDATES_USAGE}
${QUALITY_USAGE}
${COVERAGE_USAGE}`;

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
    case "validate":
      return validateCommand(rest);
    case "canary":
      return canaryCommand(rest);
    case "crawl":
      return crawlCommand(rest);
    case "health":
      return healthCommand();
    case "learn":
      return learnCommand();
    case "candidates":
      return candidatesCommand(rest);
    case "quality-report":
      return qualityCommand(rest);
    case "coverage":
      return coverageCommand(rest);
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
