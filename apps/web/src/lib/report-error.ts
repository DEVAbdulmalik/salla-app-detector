import { createLogger } from "@salla-app-detector/shared";
import { waitUntil } from "@vercel/functions";
import { getRepository } from "./database";

const logger = createLogger({ level: "info", bindings: { component: "errors" } });

const RECORD_TIMEOUT_MS = 3_000;

/**
 * Puts an unexpected failure somewhere a person will see it. Logs alone sit in the
 * hosting dashboard until someone complains, while a health event reaches the panel and
 * the alert channel next to everything else that watches the detector.
 *
 * A page that fails has usually been answered before this finishes, and the platform
 * freezes a function once its response is out, so the write is handed to `waitUntil`:
 * without it, errors in route handlers were recorded and errors in pages were not.
 */
export function reportError(
  kind: string,
  cause: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  const work = record(kind, cause, context);
  waitUntil(work);
  return work;
}

async function record(
  kind: string,
  cause: unknown,
  context: Record<string, unknown>,
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  logger.error(kind, { ...context, error: message });

  const repository = getRepository();
  if (!repository) {
    return;
  }

  try {
    // Reporting must never become the thing that fails the request.
    await Promise.race([
      repository.recordHealthEvent({
        kind,
        severity: "critical",
        detail: { ...context, error: message.slice(0, 500) },
      }),
      new Promise((resolve) => setTimeout(resolve, RECORD_TIMEOUT_MS)),
    ]);
  } catch (failure) {
    logger.error("could not record the failure", { error: String(failure) });
  }
}
