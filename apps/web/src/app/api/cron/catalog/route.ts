import { syncCatalog } from "@salla-app-detector/jobs";
import { SallaClient } from "@salla-app-detector/salla";
import { createLogger } from "@salla-app-detector/shared";
import { isAuthorized, requireRepository } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Leaves room for the response after the job stops, within the platform's limit. */
const BUDGET_MS = 240_000;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const result = await syncCatalog({
    client: new SallaClient({ timeoutMs: 20_000 }),
    repository: requireRepository(),
    logger: createLogger({ level: "info", bindings: { job: "catalog-sync" } }),
    budgetMs: BUDGET_MS,
  });

  return result.ok
    ? Response.json(result.value)
    : Response.json({ error: result.error.code }, { status: 502 });
}
