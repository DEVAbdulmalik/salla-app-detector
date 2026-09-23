import type { HealthEvent } from "@salla-app-detector/knowledge";
import { alertsEnvSchema, parseEnv, type Logger } from "@salla-app-detector/shared";

const TIMEOUT_MS = 5_000;

/**
 * Posts what the checks found to whatever endpoint is configured: Slack, Discord and
 * Telegram bots all accept a JSON body, and the message is sent as both `text` and
 * `content` so the same URL works without a per-service adapter.
 */
export async function sendAlert(events: readonly HealthEvent[], logger: Logger): Promise<void> {
  const { ALERT_WEBHOOK_URL: url } = parseEnv(alertsEnvSchema);
  if (url === undefined) {
    return;
  }

  const lines = events.map(
    (event) => `[${event.severity}] ${event.kind} ${JSON.stringify(event.detail ?? {})}`,
  );
  const message = `Salla App Detector\n${lines.join("\n")}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: message, content: message }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    logger.warn("alert endpoint refused the message", { status: response.status });
  }
}
