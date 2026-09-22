import { parseArgs } from "node:util";
import { compileKnowledge, type DetectedApp, type ScanReport } from "@salla-app-detector/engine";
import { scanStore } from "@salla-app-detector/jobs";
import { seedKnowledge } from "@salla-app-detector/knowledge";
import { SallaClient } from "@salla-app-detector/salla";

const USAGE = `Usage: pnpm cli scan <store-url> [options]

Options:
  --json            print the full report as JSON
  --products <n>    number of products to sample (default 30)
  --timeout <ms>    per-request timeout (default 15000)
`;

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== "scan" || rest.length === 0) {
    process.stdout.write(USAGE);
    return command === undefined || command === "--help" ? 0 : 1;
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      products: { type: "string" },
      timeout: { type: "string" },
    },
  });

  const url = positionals[0];
  if (url === undefined) {
    process.stdout.write(USAGE);
    return 1;
  }

  const client = new SallaClient(
    values.timeout === undefined ? {} : { timeoutMs: Number(values.timeout) },
  );
  const started = Date.now();
  const result = await scanStore(url, {
    client,
    knowledge: compileKnowledge(seedKnowledge),
    ...(values.products === undefined ? {} : { productSampleSize: Number(values.products) }),
  });

  if (!result.ok) {
    process.stderr.write(`${describeFailure(result.error)}\n`);
    return 1;
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify(result.value.report, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(render(result.value.report, Date.now() - started));
  if (result.value.productsUnavailable) {
    process.stdout.write(
      `\nnote: product sample unavailable (${result.value.productsUnavailable.code}), dropshipping not checked\n`,
    );
  }
  return 0;
}

function describeFailure(failure: { code: string; reason?: { code: string } }): string {
  const detail = failure.reason?.code;
  return detail === undefined
    ? `scan failed: ${failure.code}`
    : `scan failed: ${failure.code} (${detail})`;
}

function render(report: ScanReport, elapsedMs: number): string {
  const lines: string[] = [];
  const store = report.store;

  lines.push("");
  lines.push(`${store?.name ?? report.target.host}  —  ${report.target.host}`);
  lines.push(
    `status: ${report.status}${report.statusDetail === undefined ? "" : ` (${report.statusDetail})`}${
      store === undefined ? "" : `   store: ${String(store.id)}   theme: ${store.theme ?? "?"}`
    }`,
  );

  if (report.status !== "live") {
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push("");
  lines.push(section("apps", report.apps.map(appLine)));
  if (report.dropshipping.length > 0) {
    lines.push(section("dropshipping", report.dropshipping.map(appLine)));
  }
  lines.push(
    section(
      "integrations",
      report.integrations.map(
        (integration) =>
          `${integration.key}${integration.name === undefined ? "" : `  (${integration.name})`}`,
      ),
    ),
  );
  lines.push(
    section(
      "payments",
      [
        report.payments.methods.join(", ") || "none",
        report.payments.installments.length > 0
          ? `installments: ${report.payments.installments.join(", ")}`
          : "",
      ].filter((line) => line !== ""),
    ),
  );
  lines.push(
    section(
      "unidentified signals",
      report.unknownSignals.slice(0, 10).map((signal) => `${signal.kind}: ${signal.value}`),
    ),
  );
  lines.push(
    `engine ${report.meta.engineVersion} · knowledge ${report.meta.knowledgeVersion} · ${String(elapsedMs)} ms`,
  );
  lines.push("");
  lines.push("Apps that run only between Salla and a vendor's server leave no public trace.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function appLine(app: DetectedApp): string {
  const flags = [
    app.confidence,
    app.isDefault ? "preinstalled" : "",
    app.status === "delisted" ? "delisted" : "",
    app.status === "unidentified" ? "unidentified" : "",
  ].filter((flag) => flag !== "");
  const evidence = app.evidence.map((item) => `${item.kind}=${item.value}`).join(", ");
  return `${app.name}  [${flags.join(", ")}]\n      ${evidence}`;
}

function section(title: string, entries: readonly string[]): string {
  if (entries.length === 0) {
    return `${title}:\n  (none)\n`;
  }
  return `${title}:\n${entries.map((entry) => `  ${entry}`).join("\n")}\n`;
}

const exitCode = await main(process.argv.slice(2));
process.exitCode = exitCode;
