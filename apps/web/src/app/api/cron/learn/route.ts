import { learn, mineAppSignals } from "@salla-app-detector/jobs";
import { createLogger } from "@salla-app-detector/shared";
import { isAuthorized, requireRepository } from "@/lib/cron";
import { runHealth } from "@/lib/health-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const repository = requireRepository();
  const learned = await learn({
    repository,
    logger: createLogger({ level: "info", bindings: { job: "learn" } }),
  });

  // Mining reads only what harvests and visitors' scans already stored, so it is safe to run
  // from here even though Salla refuses the deployment's addresses.
  const mined = await mineAppSignals({
    repository,
    logger: createLogger({ level: "info", bindings: { job: "mine" } }),
  });

  // The nightly monitoring runs here rather than on a schedule of its own: the plan allows
  // two daily crons and the catalogue sync holds the other one. It runs after learning so
  // the checks see the knowledge that was just published.
  const checked = await runHealth(createLogger({ level: "info", bindings: { job: "health" } }));

  return Response.json({
    learned,
    mined: { apps: mined.apps.length, candidates: mined.candidates.length },
    health: checked,
  });
}
