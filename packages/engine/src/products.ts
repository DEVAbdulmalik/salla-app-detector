import { describeHost } from "./domains";
import type { CompiledKnowledge } from "./knowledge";
import type { Evidence } from "./types";

export interface ProductSample {
  readonly sku?: string;
  readonly imageUrls: readonly string[];
}

export interface ProductAnalysis {
  readonly sampleSize: number;
  readonly evidence: readonly Evidence[];
  readonly unknownImageHosts: readonly Evidence[];
}

/** A signal has to run through a real part of the catalogue, not a single stray product. */
const MIN_SHARE = 0.2;
const MIN_COUNT = 3;

/**
 * Dropshipping apps rarely touch the storefront, but they import products complete with
 * the supplier's image URLs and SKU shapes, which the public product API exposes.
 */
export function analyzeProducts(
  products: readonly ProductSample[],
  knowledge: CompiledKnowledge,
): ProductAnalysis {
  if (products.length === 0) {
    return { sampleSize: 0, evidence: [], unknownImageHosts: [] };
  }

  const imageHostCounts = countImageHosts(products);
  const evidence: Evidence[] = [];
  const matchedHosts = new Set<string>();

  for (const fingerprint of knowledge.products) {
    const threshold = fingerprint.minProductShare ?? MIN_SHARE;

    if (fingerprint.kind === "product-image-host") {
      const count = imageHostCounts.get(fingerprint.pattern) ?? 0;
      if (passes(count, products.length, threshold)) {
        matchedHosts.add(fingerprint.pattern);
        evidence.push({
          kind: "product-image-host",
          value: fingerprint.pattern,
          detail: shareLabel(count, products.length, "product images from"),
        });
      }
      continue;
    }

    const prefix = fingerprint.pattern.toLowerCase();
    const count = products.filter((product) =>
      product.sku?.toLowerCase().startsWith(prefix),
    ).length;
    if (passes(count, products.length, threshold)) {
      evidence.push({
        kind: "product-sku-prefix",
        value: fingerprint.pattern,
        detail: shareLabel(count, products.length, "product codes starting with"),
      });
    }
  }

  const unknownImageHosts: Evidence[] = [];
  for (const [host, count] of imageHostCounts) {
    if (!matchedHosts.has(host) && passes(count, products.length, MIN_SHARE)) {
      unknownImageHosts.push({
        kind: "product-image-host",
        value: host,
        detail: shareLabel(count, products.length, "product images from"),
      });
    }
  }

  return { sampleSize: products.length, evidence, unknownImageHosts };
}

function countImageHosts(products: readonly ProductSample[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const product of products) {
    const hosts = new Set<string>();
    for (const url of product.imageUrls) {
      const info = describeHost(url);
      if (info && !isPlatformImageHost(info.domain)) {
        hosts.add(info.host);
      }
    }
    for (const host of hosts) {
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  return counts;
}

function isPlatformImageHost(domain: string): boolean {
  return domain === "salla.sa" || domain === "salla.network" || domain === "salla.cloud";
}

function passes(count: number, total: number, share: number): boolean {
  return count >= MIN_COUNT || count / total >= share;
}

function shareLabel(count: number, total: number, prefix: string): string {
  return `${prefix} ${count} of ${total} sampled products`;
}
