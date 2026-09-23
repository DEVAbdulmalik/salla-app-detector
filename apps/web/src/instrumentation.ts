/**
 * Next calls this for every error it catches on the server: a page, a route handler or a
 * server action. Recording them here means a broken page raises the same kind of alert as
 * a broken job, instead of waiting for someone to report it.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
): Promise<void> {
  const { reportError } = await import("./lib/report-error");
  await reportError("request-failed", error, { path: request.path, method: request.method });
}
