/**
 * Watches the two ways the server can fail. Next reports what it catches itself — a page,
 * a route handler, a server action — through `onRequestError`. A rejected promise that
 * nothing awaits never reaches it: the visitor may even get a normal page while the work
 * behind it failed, so the process is watched for those too.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { reportError } = await import("./lib/report-error");

  process.on("unhandledRejection", (reason) => {
    void reportError("unhandled-rejection", reason);
  });
  process.on("uncaughtException", (error) => {
    void reportError("uncaught-exception", error);
  });
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
): Promise<void> {
  const { reportError } = await import("./lib/report-error");
  await reportError("request-failed", error, { path: request.path, method: request.method });
}
