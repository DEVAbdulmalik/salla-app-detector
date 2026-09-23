import { learn } from "@salla-app-detector/jobs";
import { createLogger } from "@salla-app-detector/shared";
import { isAuthorized, requireRepository } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const result = await learn({
    repository: requireRepository(),
    logger: createLogger({ level: "info", bindings: { job: "learn" } }),
  });

  return Response.json(result);
}
