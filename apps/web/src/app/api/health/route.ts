import { databaseUrl, getRepository } from "@/lib/database";
import { supabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports what this instance is running and whether its dependencies answer. */
export async function GET(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const repository = getRepository();
  const deep = new URL(request.url).searchParams.get("deep") === "1";

  let database: "ok" | "unreachable" | "not-configured" = "not-configured";
  const timings: Record<string, number | string> = {};

  if (repository) {
    try {
      await repository.jobState("catalog-sync");
      database = "ok";
    } catch {
      database = "unreachable";
    }
  }

  // Timing the calls a scan makes shows which one is slow in a deployed environment.
  if (deep && repository && database === "ok") {
    let knowledgeVersion = "none";
    timings.snapshot = await timed(async () => {
      const snapshot = await repository.readPublishedSnapshot();
      knowledgeVersion = snapshot?.version ?? "none";
    });
    timings.knowledgeVersion = knowledgeVersion;
    timings.recentScan = await timed(() => repository.recentScan("example.test", 360));
    timings.rateLimit = await timed(() => repository.consumeRateLimit("health", 1000, 60));
  }

  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    region: process.env.VERCEL_REGION ?? "local",
    databaseConfigured: databaseUrl() !== undefined,
    database,
    ...(deep ? { timings, settings: settingsReport() } : {}),
    checkedInMs: Date.now() - startedAt,
  });
}

/**
 * Which optional settings this deployment actually received. Only whether a value is
 * present is reported: an absent cron secret closes the scheduled endpoints rather than
 * opening them, so there is nothing here worth hiding.
 */
function settingsReport(): Record<string, boolean | number> {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  return {
    supabaseAuth: supabaseConfig() !== undefined,
    adminEmails: admins.length,
    cronSecret: (process.env.CRON_SECRET ?? "") !== "",
    alertWebhook: (process.env.ALERT_WEBHOOK_URL ?? "") !== "",
  };
}

async function timed(work: () => Promise<unknown>): Promise<number | string> {
  const startedAt = Date.now();
  try {
    await work();
    return Date.now() - startedAt;
  } catch (error) {
    return `failed after ${String(Date.now() - startedAt)}ms: ${error instanceof Error ? error.message : "unknown"}`;
  }
}
