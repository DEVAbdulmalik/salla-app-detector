import type { Evidence, Fingerprint, KnowledgeSnapshot } from "./types";

export interface CompiledKnowledge {
  readonly snapshot: KnowledgeSnapshot;
  /** Exact lookups keyed by `kind:pattern`. */
  readonly exact: ReadonlyMap<string, readonly Fingerprint[]>;
  /** Comment markers are matched as substrings, so they need a scan. */
  readonly markers: readonly Fingerprint[];
  readonly products: readonly Fingerprint[];
}

const PRODUCT_KINDS = new Set<Evidence["kind"]>(["product-image-host", "product-sku-prefix"]);

/**
 * Prepares the lookups used by every scan. Compiling once per snapshot keeps matching a
 * handful of map lookups per signal instead of a pass over the whole fingerprint set.
 */
export function compileKnowledge(snapshot: KnowledgeSnapshot): CompiledKnowledge {
  const exact = new Map<string, Fingerprint[]>();
  const markers: Fingerprint[] = [];
  const products: Fingerprint[] = [];

  for (const fingerprint of snapshot.fingerprints) {
    if (fingerprint.kind === "inline-marker") {
      markers.push({ ...fingerprint, pattern: fingerprint.pattern.toLowerCase() });
      continue;
    }
    if (PRODUCT_KINDS.has(fingerprint.kind)) {
      products.push(fingerprint);
    }
    const key = indexKey(fingerprint.kind, fingerprint.pattern);
    const bucket = exact.get(key);
    if (bucket) {
      bucket.push(fingerprint);
    } else {
      exact.set(key, [fingerprint]);
    }
  }

  return { snapshot, exact, markers, products };
}

export function indexKey(kind: Evidence["kind"], pattern: string): string {
  return `${kind}:${pattern}`;
}
