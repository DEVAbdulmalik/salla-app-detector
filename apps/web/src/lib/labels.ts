import type { Integration } from "@salla-app-detector/engine";
import type { Messages } from "./messages";

/**
 * Salla identifies integrations and payment methods by internal keys. Known ones get a
 * proper name; the rest are tidied rather than shown raw, so a new key added by Salla
 * still reads as a label instead of leaking into the interface.
 */
export function integrationLabel(integration: Integration, messages: Messages): string {
  if (integration.name !== undefined) {
    return integration.name;
  }
  const known: Record<string, string> = messages.report.integrationNames;
  return known[integration.key] ?? humanize(integration.key);
}

export function paymentLabel(key: string, messages: Messages): string {
  const known: Record<string, string> = messages.report.paymentNames;
  return known[key] ?? humanize(key);
}

function humanize(key: string): string {
  return key
    .replace(/^addon-/, "")
    .split(/[-_]/)
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
