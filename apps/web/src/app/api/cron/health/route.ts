import { createLogger } from "@salla-app-detector/shared";
import { isAuthorized } from "@/lib/cron";
import { runHealth } from "@/lib/health-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const result = await runHealth(createLogger({ level: "info", bindings: { job: "health" } }));
  return Response.json(result);
}
