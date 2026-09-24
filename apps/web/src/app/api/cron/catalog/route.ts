import { syncCatalog, syncThemes } from "@salla-app-detector/jobs";
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

  const client = new SallaClient({ timeoutMs: 20_000 });
  const repository = requireRepository();

  // The theme catalogue is one request, so it rides along with the catalogue refresh
  // rather than taking a schedule of its own.
  const themes = await syncThemes({
    client,
    repository,
    logger: createLogger({ level: "info", bindings: { job: "theme-sync" } }),
  });

  const result = await syncCatalog({
    client,
    repository,
    logger: createLogger({ level: "info", bindings: { job: "catalog-sync" } }),
    budgetMs: BUDGET_MS,
  });

  const themeSummary = themes.ok ? themes.value : { error: themes.error.code };
  return result.ok
    ? Response.json({ ...result.value, themes: themeSummary })
    : Response.json({ error: result.error.code, themes: themeSummary }, { status: 502 });
}
