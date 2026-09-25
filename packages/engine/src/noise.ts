import { describeHost } from "./domains";
import type { Evidence, NoiseRules } from "./types";

/** Salla's own infrastructure. Present on every storefront, so it identifies nothing. */
const PLATFORM_DOMAINS = ["salla.sa", "salla.network", "salla.dev", "salla.com", "salla.cloud"];

const PLATFORM_ELEMENT_PREFIX = "salla-";

/**
 * Salla loads its own Tag Manager container on every storefront to run the integrations a
 * merchant switches on. Any other container is one the merchant brought.
 */
export const PLATFORM_TAG_CONTAINERS: readonly string[] = ["GTM-TGFC6FV"];

export interface NoiseSplit {
  readonly signals: readonly Evidence[];
  readonly noise: readonly Evidence[];
}

/**
 * Separates the signals worth matching from the background every Salla store shares.
 * Anything dropped here can never become a detection, so the rules stay explicit and
 * reviewable rather than heuristic.
 */
export function filterNoise(evidence: readonly Evidence[], rules: NoiseRules): NoiseSplit {
  const hosts = new Set(rules.hosts);
  const domains = new Set(rules.domains);
  const identifiers = new Set(rules.identifiers);
  const signatures = new Set(rules.inlineSignatures);
  const markers = new Set(rules.markers);
  const elementIds = new Set(rules.elementIds);
  const customElements = new Set(rules.customElements);

  const signals: Evidence[] = [];
  const noise: Evidence[] = [];

  for (const item of evidence) {
    (isNoise(item) ? noise : signals).push(item);
  }

  return { signals, noise };

  function isNoise(item: Evidence): boolean {
    switch (item.kind) {
      case "host":
        // A host inherits its domain's verdict: ruling out sift.com also rules out cdn.sift.com.
        return (
          hosts.has(item.value) ||
          isPlatformHost(item.value) ||
          domains.has(describeHost(item.value)?.domain ?? item.value)
        );
      case "domain":
        return domains.has(item.value) || isPlatformHost(item.value);
      case "inline-token":
        return identifiers.has(item.value);
      case "inline-signature":
        return signatures.has(item.value);
      case "inline-marker":
        return markers.has(item.value);
      case "dom-id":
        return elementIds.has(item.value);
      case "custom-element":
        return customElements.has(item.value) || item.value.startsWith(PLATFORM_ELEMENT_PREFIX);
      case "snippet":
      case "service":
      case "bundle":
      case "tag-container":
      case "product-image-host":
      case "product-sku-prefix":
        return false;
    }
  }
}

function isPlatformHost(host: string): boolean {
  return PLATFORM_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
