import { parseArgs } from "node:util";
import { scanStore } from "@salla-app-detector/jobs";
import { SallaClient } from "@salla-app-detector/salla";
import { loadKnowledge } from "../context";
import { renderReport } from "./render";

export const SCAN_USAGE = `Usage: pnpm cli scan <store-url> [options]

Options:
  --json            print the full report as JSON
  --products <n>    number of products to sample (default 30)
  --timeout <ms>    per-request timeout (default 15000)
  --seed            use the bundled knowledge instead of the database
`;

export async function scanCommand(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      seed: { type: "boolean", default: false },
      products: { type: "string" },
      timeout: { type: "string" },
    },
  });

  const url = positionals[0];
  if (url === undefined) {
    process.stdout.write(SCAN_USAGE);
    return 1;
  }

  const knowledge = await loadKnowledge(values.seed);
  const client = new SallaClient(
    values.timeout === undefined ? {} : { timeoutMs: Number(values.timeout) },
  );
  const started = Date.now();

  try {
    const result = await scanStore(url, {
      client,
      knowledge: knowledge.knowledge,
      ...(values.products === undefined ? {} : { productSampleSize: Number(values.products) }),
    });

    if (!result.ok) {
      const detail = "reason" in result.error ? ` (${result.error.reason.code})` : "";
      process.stderr.write(`scan failed: ${result.error.code}${detail}\n`);
      return 1;
    }

    if (values.json) {
      process.stdout.write(`${JSON.stringify(result.value.report, null, 2)}\n`);
      return 0;
    }

    process.stdout.write(renderReport(result.value.report, Date.now() - started));
    process.stdout.write(`knowledge source: ${knowledge.source}\n`);
    if (result.value.productsUnavailable) {
      process.stdout.write(
        `note: product sample unavailable (${result.value.productsUnavailable.code}), dropshipping not checked\n`,
      );
    }
    return 0;
  } finally {
    await knowledge.close();
  }
}
