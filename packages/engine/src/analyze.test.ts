import { describe, expect, it } from "vitest";
import { analyzeStore } from "./analyze";
import { compileKnowledge } from "./knowledge";
import type { AppInfo, Fingerprint, KnowledgeSnapshot } from "./types";

const apps: Record<string, AppInfo> = {
  "1514900071": {
    id: "1514900071",
    name: "توليفاي بلس",
    status: "listed",
    categories: ["التسويق"],
  },
  "1406425291": { id: "1406425291", name: "Hotjar", status: "listed" },
  "610038364": { id: "610038364", name: "M5AZN", status: "listed" },
  "691365818": { id: "691365818", name: "مترجم التقييمات", status: "listed", isDefault: true },
  "900": { id: "900", name: "First App", status: "listed" },
  "901": { id: "901", name: "Second App", status: "listed" },
};

const fingerprints: Fingerprint[] = [
  {
    id: "domain:tooliify.com",
    kind: "domain",
    pattern: "tooliify.com",
    strength: "strong",
    target: { type: "app", appId: "1514900071" },
  },
  {
    id: "token:tooliify",
    kind: "inline-token",
    pattern: "tooliifySettings",
    strength: "strong",
    target: { type: "app", appId: "1514900071" },
  },
  {
    id: "service:hotjar",
    kind: "service",
    pattern: "hotjar",
    strength: "decisive",
    target: { type: "app", appId: "1406425291" },
  },
  {
    id: "product:m5azn",
    kind: "product-image-host",
    pattern: "supplier-cdn.example",
    strength: "strong",
    target: { type: "app", appId: "610038364" },
  },
  {
    id: "domain:shared-studio.example",
    kind: "domain",
    pattern: "shared-studio.example",
    strength: "strong",
    target: { type: "company", company: "Shared Studio", appIds: ["900", "901"] },
  },
];

const knowledge = compileKnowledge({
  version: "test-1",
  apps,
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
} satisfies KnowledgeSnapshot);

const CONFIG = {
  "twilight::init": {
    store: {
      id: 555,
      name: "متجر الاختبار",
      username: "test-store",
      settings: { payments: ["mada"], installments: { tabby: { publicKey: "p" } } },
    },
    theme: { name: "1130931637", twilight: { version: "2.14.584" } },
  },
  "services::hotjar.init": { services: { hotjar: { hotjar_id: "1" } } },
  "services::brand_new_pixel.init": { services: { brand_new_pixel: { id: "2" } } },
};

function page(body: string, config: unknown = CONFIG): string {
  return `<html><head><script src="https://cdn.salla.network/js/twilight/2.14.584/twilight.esm.js"></script></head>
    <body>${body}
      <script>salla.event.dispatchEvents(${JSON.stringify(config)})</script>
    </body></html>`;
}

function scan(html: string, products: { sku?: string; imageUrls: string[] }[] = []) {
  return analyzeStore(
    {
      target: { url: "https://test-store.example/", host: "test-store.example" },
      page: { status: 200, finalUrl: "https://test-store.example/", html },
      products,
    },
    knowledge,
  );
}

describe("analyzeStore", () => {
  it("reports the store, its apps, integrations and payments", () => {
    const report = scan(
      page(`<script src="https://files.tooliify.com/widget.js"></script>
            <script>window.tooliifySettings = {};</script>
            <script async src="https://cdn.portal.files.salla.network/snippets/prod/691365818/1.js" data-snippet-id="9"></script>
            <script src="https://unknown-vendor.example/app.js"></script>`),
    );

    expect(report.status).toBe("live");
    expect(report.store).toEqual({
      id: 555,
      name: "متجر الاختبار",
      username: "test-store",
      theme: "1130931637",
      twilightVersion: "2.14.584",
    });
    expect(report.apps.map((app) => [app.appId, app.confidence])).toEqual([
      ["1514900071", "confirmed"],
      ["691365818", "confirmed"],
    ]);
    expect(report.payments).toEqual({ methods: ["mada"], installments: ["tabby"] });
    expect(report.meta.knowledgeVersion).toBe("test-1");
    expect(report.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("marks the preinstalled app so it can be told apart from the merchant's choices", () => {
    const report = scan(
      page(
        '<script async src="https://cdn.portal.files.salla.network/snippets/prod/691365818/1.js" data-snippet-id="9"></script>',
      ),
    );

    expect(report.apps).toHaveLength(1);
    expect(report.apps[0]).toMatchObject({ appId: "691365818", isDefault: true });
  });

  it("lists built-in integrations separately, named where known", () => {
    const report = scan(page(""));

    expect(report.integrations).toEqual([
      { key: "brand_new_pixel" },
      { key: "hotjar", appId: "1406425291", name: "Hotjar" },
    ]);
    expect(report.apps.map((app) => app.appId)).not.toContain("1406425291");
  });

  it("reports a dropshipping supplier found in the product sample", () => {
    const report = scan(page(""), [
      { sku: "A", imageUrls: ["https://supplier-cdn.example/1.jpg"] },
      { sku: "B", imageUrls: ["https://supplier-cdn.example/2.jpg"] },
      { sku: "C", imageUrls: ["https://supplier-cdn.example/3.jpg"] },
    ]);

    expect(report.dropshipping.map((app) => app.appId)).toEqual(["610038364"]);
    expect(report.apps.map((app) => app.appId)).not.toContain("610038364");
  });

  it("says a shared developer domain narrows things to a company, not an app", () => {
    const report = scan(page('<script src="https://cdn.shared-studio.example/w.js"></script>'));

    expect(report.apps[0]).toMatchObject({
      appId: "company:Shared Studio",
      confidence: "possible",
      ambiguousWith: ["900", "901"],
    });
  });

  it("keeps unfamiliar signals for the learning loop", () => {
    const report = scan(page('<script src="https://unknown-vendor.example/app.js"></script>'));

    expect(report.unknownSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "domain", value: "unknown-vendor.example" }),
        expect.objectContaining({ kind: "service", value: "brand_new_pixel" }),
      ]),
    );
    expect(report.unknownSignals.some((signal) => signal.kind === "host")).toBe(false);
  });

  it("keeps the store's CDN code, which ties review avatars back to this storefront", () => {
    const report = scan(page(`<img src="https://cdn.salla.sa/QNvEG/logo.png">`));

    expect(report.store?.assetCode).toBe("QNvEG");
  });

  it("returns an empty report for a page that is not a live store", () => {
    const report = scan("<html><body>a plain page</body></html>");

    expect(report).toMatchObject({
      status: "not-salla",
      apps: [],
      integrations: [],
      unknownSignals: [],
    });
  });
});
