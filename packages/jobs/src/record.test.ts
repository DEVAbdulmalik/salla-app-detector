import type { DetectedApp, ScanReport } from "@salla-app-detector/engine";
import { describe, expect, it } from "vitest";
import { matchedSignals } from "./record";

function app(appId: string, evidence: { kind: string; value: string }[]): DetectedApp {
  return {
    appId,
    name: appId,
    categories: [],
    status: "listed",
    isDefault: false,
    confidence: "strong",
    evidence: evidence.map((item) => ({ ...item, strength: "strong" })),
  } as DetectedApp;
}

function report(sections: Partial<ScanReport>): ScanReport {
  return {
    target: { url: "https://store.test/", host: "store.test", key: "store.test" },
    status: "live",
    apps: [],
    dropshipping: [],
    integrations: [],
    payments: { methods: [], installments: [] },
    unknownSignals: [],
    meta: { engineVersion: "1.0.0", knowledgeVersion: "test" },
    ...sections,
  };
}

describe("matchedSignals", () => {
  it("counts matches from the page, the product sample and the integrations", () => {
    const signals = matchedSignals(
      report({
        apps: [app("1", [{ kind: "snippet", value: "1" }])],
        dropshipping: [app("2", [{ kind: "product-image-host", value: "ae01.alicdn.com" }])],
        integrations: [{ key: "google_analytics", appId: "3", name: "Google Analytics" }],
      }),
    );

    expect(signals).toEqual([
      { kind: "snippet", value: "1" },
      { kind: "product-image-host", value: "ae01.alicdn.com" },
      { kind: "service", value: "google_analytics" },
    ]);
  });

  it("leaves out an integration no fingerprint explained", () => {
    const signals = matchedSignals(report({ integrations: [{ key: "tiktok_pixel" }] }));

    expect(signals).toEqual([]);
  });
});
