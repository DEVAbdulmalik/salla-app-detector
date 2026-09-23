import { databaseUrl, getRepository } from "@/lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports what this instance is running and whether its dependencies answer. */
export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  const repository = getRepository();

  let database: "ok" | "unreachable" | "not-configured" = "not-configured";
  if (repository) {
    try {
      await repository.jobState("catalog-sync");
      database = "ok";
    } catch {
      database = "unreachable";
    }
  }

  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    region: process.env.VERCEL_REGION ?? "local",
    databaseConfigured: databaseUrl() !== undefined,
    database,
    checkedInMs: Date.now() - startedAt,
  });
}
