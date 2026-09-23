import { getRepository } from "./database";

/**
 * Vercel sends the project's cron secret with every scheduled request. Checking it keeps
 * the jobs from being triggered by anyone who finds the URL.
 */
export function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "") {
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export function requireRepository() {
  const repository = getRepository();
  if (!repository) {
    throw new Error("DATABASE_URL is not configured");
  }
  return repository;
}
