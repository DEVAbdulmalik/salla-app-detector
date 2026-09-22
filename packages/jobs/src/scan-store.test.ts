import { compileKnowledge, type KnowledgeSnapshot } from "@salla-app-detector/engine";
import type { ApiFailure, FetchFailure, ProductSummary } from "@salla-app-detector/salla";
import { err, ok, type Result } from "@salla-app-detector/shared";
import { describe, expect, it } from "vitest";
import { scanStore, type ScanClient } from "./scan-store";

const knowledge = compileKnowledge({
  version: "test",
  apps: { "1514900071": { id: "1514900071", name: "توليفاي بلس", status: "listed" } },
  fingerprints: [
    {
      id: "domain:tooliify.com",
      kind: "domain",
      pattern: "tooliify.com",
      strength: "strong",
      target: { type: "app", appId: "1514900071" },
    },
    {
      id: "product:supplier",
      kind: "product-image-host",
      pattern: "supplier-cdn.example",
      strength: "strong",
      target: { type: "app", appId: "1514900071" },
    },
  ],
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

const CONFIG = { "twilight::init": { store: { id: 4242, name: "متجر" } } };

function storePage(): string {
  return `<html><head><script src="https://cdn.salla.network/js/twilight/2.14.584/twilight.esm.js"></script></head>
    <body><script src="https://files.tooliify.com/widget.js"></script>
    <script>salla.event.dispatchEvents(${JSON.stringify(CONFIG)})</script></body></html>`;
}

interface StubOptions {
  readonly html?: string;
  readonly status?: number;
  readonly finalUrl?: string;
  readonly fetchFailure?: FetchFailure;
  readonly products?: ProductSummary[];
  readonly productFailure?: ApiFailure;
}

function stubClient(options: StubOptions = {}): { client: ScanClient; productCalls: number[] } {
  const productCalls: number[] = [];
  const client: ScanClient = {
    fetchStorefront: (url) => {
      if (options.fetchFailure) {
        return Promise.resolve(err(options.fetchFailure));
      }
      return Promise.resolve(
        ok({
          status: options.status ?? 200,
          finalUrl: options.finalUrl ?? url,
          headers: {},
          body: options.html ?? storePage(),
        }),
      );
    },
    fetchProducts: (storeId) => {
      productCalls.push(storeId);
      return Promise.resolve(
        (options.productFailure
          ? err(options.productFailure)
          : ok(options.products ?? [])) as Result<ProductSummary[], ApiFailure>,
      );
    },
  };
  return { client, productCalls };
}

describe("scanStore", () => {
  it("scans a store and reports what it found", async () => {
    const { client, productCalls } = stubClient({ finalUrl: "https://mystore.com/" });

    const result = await scanStore("mystore.com", { client, knowledge });

    if (!result.ok) {
      throw new Error(`expected a scan, got ${result.error.code}`);
    }
    expect(result.value.report.status).toBe("live");
    expect(result.value.report.store?.id).toBe(4242);
    expect(result.value.report.apps.map((app) => app.appId)).toEqual(["1514900071"]);
    expect(productCalls).toEqual([4242]);
  });

  it("reports the store under the domain it redirected to", async () => {
    const { client } = stubClient({ finalUrl: "https://coffeesouq1.com/" });

    const result = await scanStore("https://salla.sa/coffee_souq", { client, knowledge });

    expect(result.ok && result.value.report.target.host).toBe("coffeesouq1.com");
    expect(result.ok && result.value.target.slug).toBe("coffee_souq");
  });

  it("uses the product sample to spot a supplier", async () => {
    const { client } = stubClient({
      products: [
        { imageUrls: ["https://supplier-cdn.example/1.jpg"] },
        { imageUrls: ["https://supplier-cdn.example/2.jpg"] },
        { imageUrls: ["https://supplier-cdn.example/3.jpg"] },
      ],
    });

    const result = await scanStore("mystore.com", { client, knowledge });

    expect(result.ok && result.value.report.dropshipping.map((app) => app.appId)).toEqual([]);
    expect(result.ok && result.value.report.apps.map((app) => app.appId)).toEqual(["1514900071"]);
  });

  it("still reports when the product sample cannot be read", async () => {
    const { client } = stubClient({
      productFailure: { code: "http", status: 403, endpoint: "/products" },
    });

    const result = await scanStore("mystore.com", { client, knowledge });

    expect(result.ok && result.value.report.status).toBe("live");
    expect(result.ok && result.value.productsUnavailable).toMatchObject({ code: "http" });
  });

  it("does not ask for products when the page is not a live store", async () => {
    const { client, productCalls } = stubClient({ html: "<html><body>hello</body></html>" });

    const result = await scanStore("mystore.com", { client, knowledge });

    expect(result.ok && result.value.report.status).toBe("not-salla");
    expect(productCalls).toEqual([]);
  });

  it("rejects input that is not a store URL", async () => {
    const { client } = stubClient();

    const result = await scanStore("https://apps.salla.sa/ar/app/1", { client, knowledge });

    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "invalid-input",
      reason: { code: "platform-page" },
    });
  });

  it("passes a fetch failure back to the caller", async () => {
    const { client } = stubClient({ fetchFailure: { code: "timeout" } });

    const result = await scanStore("mystore.com", { client, knowledge });

    expect(result.ok ? undefined : result.error).toEqual({
      code: "fetch-failed",
      reason: { code: "timeout" },
    });
  });
});
