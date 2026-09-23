import { compileKnowledge } from "@salla-app-detector/engine";
import { health, sallaContracts, type HealthResult } from "@salla-app-detector/jobs";
import { seedKnowledge } from "@salla-app-detector/knowledge";
import { SallaClient } from "@salla-app-detector/salla";
import type { Logger } from "@salla-app-detector/shared";
import { requireRepository } from "./cron";
import { sendAlert } from "./alerts";

/** Canaries are scanned patiently: a slow store here delays a report nobody is waiting for. */
const REQUEST_TIMEOUT_MS = 20_000;

export async function runHealth(logger: Logger): Promise<HealthResult> {
  const repository = requireRepository();
  const snapshot = await repository.readPublishedSnapshot();

  const client = new SallaClient({ timeoutMs: REQUEST_TIMEOUT_MS });

  return health({
    repository,
    client,
    contracts: sallaContracts(client),
    knowledge: compileKnowledge(snapshot ?? seedKnowledge),
    notify: (events) => sendAlert(events, logger),
    logger,
  });
}
