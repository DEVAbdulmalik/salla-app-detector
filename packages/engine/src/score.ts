import type { Match } from "./match";
import type { Confidence, EvidenceKind } from "./types";

/**
 * Signals from the same place in a page tend to rise and fall together: a vendor's domain
 * appears as both a host and a domain, and one script yields several identifiers. Grouping
 * them means "two independent signals" really means two independent places.
 */
const GROUPS = {
  snippet: "snippet",
  service: "service",
  domain: "network",
  host: "network",
  "inline-token": "inline",
  "inline-marker": "inline",
  "inline-signature": "inline",
  "dom-id": "dom",
  "custom-element": "dom",
  bundle: "dom",
  "tag-container": "tag",
  "product-image-host": "product",
  "product-sku-prefix": "product",
} as const satisfies Record<EvidenceKind, string>;

export function confidenceOf(matches: readonly Match[]): Confidence {
  const strongGroups = new Set<string>();

  for (const match of matches) {
    if (match.fingerprint.strength === "decisive") {
      return "confirmed";
    }
    if (match.fingerprint.strength === "strong") {
      strongGroups.add(GROUPS[match.evidence.kind]);
    }
  }

  if (strongGroups.size >= 2) {
    return "confirmed";
  }
  return strongGroups.size === 1 ? "strong" : "possible";
}
