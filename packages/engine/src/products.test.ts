import { describe, expect, it } from "vitest";
import { compileKnowledge } from "./knowledge";
import { analyzeProducts, type ProductSample } from "./products";
import type { Fingerprint } from "./types";

const fingerprints: Fingerprint[] = [
  {
    id: "product:m5azn",
    kind: "product-image-host",
    pattern: "d1gpzof0viq1mp.cloudfront.net",
    strength: "strong",
    target: { type: "app", appId: "610038364" },
  },
  {
    id: "product:autodrop",
    kind: "product-sku-prefix",
    pattern: "ADAE1005",
    strength: "strong",
    target: { type: "app", appId: "1090140720" },
  },
];

const knowledge = compileKnowledge({
  version: "test",
  apps: {},
  themes: {},
  fingerprints,
  noise: {
    hosts: [],
    domains: [],
    identifiers: [],
    inlineSignatures: [],
    markers: [],
    elementIds: [],
    customElements: [],
  },
});

function products(count: number, build: (index: number) => ProductSample): ProductSample[] {
  return Array.from({ length: count }, (_value, index) => build(index));
}

const sallaHosted: ProductSample = {
  sku: "LOCAL-1",
  imageUrls: ["https://cdn.salla.sa/QNvEG/product.png"],
};

describe("analyzeProducts", () => {
  it("detects a supplier that hosts a store's product images", () => {
    const sample = [
      ...products(8, (index) => ({
        sku: `X-${index}`,
        imageUrls: ["https://d1gpzof0viq1mp.cloudfront.net/products/a.jpg"],
      })),
      ...products(22, () => sallaHosted),
    ];

    const analysis = analyzeProducts(sample, knowledge);

    expect(analysis.evidence).toEqual([
      {
        kind: "product-image-host",
        value: "d1gpzof0viq1mp.cloudfront.net",
        detail: "product images from 8 of 30 sampled products",
      },
    ]);
  });

  it("detects an importer by the shape of its product codes", () => {
    const sample = products(10, (index) => ({
      sku: index < 6 ? `ADAE1005${index}00000` : `SKU-${index}`,
      imageUrls: [],
    }));

    expect(analyzeProducts(sample, knowledge).evidence).toEqual([
      {
        kind: "product-sku-prefix",
        value: "ADAE1005",
        detail: "product codes starting with 6 of 10 sampled products",
      },
    ]);
  });

  it("ignores a single stray product", () => {
    const sample = [
      { sku: "ADAE100512345", imageUrls: ["https://d1gpzof0viq1mp.cloudfront.net/a.jpg"] },
      ...products(40, () => sallaHosted),
    ];

    expect(analyzeProducts(sample, knowledge).evidence).toEqual([]);
  });

  it("reports unfamiliar image hosts for later investigation", () => {
    const sample = products(10, () => ({
      sku: "A",
      imageUrls: ["https://cdn.dsmcdn.com/a.jpg", "https://cdn.salla.sa/b.jpg"],
    }));

    const analysis = analyzeProducts(sample, knowledge);

    expect(analysis.evidence).toEqual([]);
    expect(analysis.unknownImageHosts.map((item) => item.value)).toEqual(["cdn.dsmcdn.com"]);
  });

  it("does nothing without a sample", () => {
    expect(analyzeProducts([], knowledge)).toEqual({
      sampleSize: 0,
      evidence: [],
      unknownImageHosts: [],
    });
  });
});
