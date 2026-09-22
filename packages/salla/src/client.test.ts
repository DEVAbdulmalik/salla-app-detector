import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ok, type Result } from "@salla-app-detector/shared";
import { describe, expect, it } from "vitest";
import { SallaClient, type PageFetcher } from "./client";
import type { FetchFailure, FetchedPage } from "./safe-fetch";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), "utf8");
}

interface Call {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
}

/** Serves recorded responses so the client's behaviour is tested without network access. */
function stub(routes: Record<string, string | { status: number; body: string }>): {
  fetchPage: PageFetcher;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchPage: PageFetcher = (url, options) => {
    calls.push({ url, headers: options.headers ?? {}, method: options.method ?? "GET" });
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    const response = match?.[1];
    if (response === undefined) {
      throw new Error(`no recorded response for ${url}`);
    }
    const { status, body } =
      typeof response === "string" ? { status: 200, body: response } : response;
    const page: FetchedPage = {
      status,
      finalUrl: url,
      headers: { "content-type": "application/json" },
      body,
      bytes: body.length,
      redirects: [],
    };
    return Promise.resolve(ok(page) as Result<FetchedPage, FetchFailure>);
  };
  return { fetchPage, calls };
}

function unwrap<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe("SallaClient products", () => {
  it("reduces the product listing to codes and image hosts", async () => {
    const { fetchPage, calls } = stub({ "/products": fixture("products") });
    const client = new SallaClient({ fetchPage });

    const products = unwrap(await client.fetchProducts(986119567, 3));

    expect(products.length).toBeGreaterThan(0);
    expect(products[0]?.imageUrls[0]).toMatch(/^https:\/\//);
    expect(calls[0]?.headers["store-identifier"]).toBe("986119567");
  });

  it("refuses a store id that is not a positive integer", async () => {
    const { fetchPage } = stub({ "/products": fixture("products") });
    const client = new SallaClient({ fetchPage });

    await expect(client.fetchProducts(-1)).rejects.toThrow(TypeError);
    await expect(client.fetchProducts(1.5)).rejects.toThrow(TypeError);
  });
});

describe("SallaClient store lookup", () => {
  it("finds a store's address from its menu", async () => {
    const { fetchPage } = stub({ "menus/header": fixture("menus-header") });
    const client = new SallaClient({ fetchPage });

    expect(unwrap(await client.resolveStoreUrl(986119567))).toBe("https://mahwous.com/");
  });

  it("falls back to product links when the menus are empty", async () => {
    const { fetchPage } = stub({
      "menus/header": '{"data":[]}',
      "menus/footer": '{"data":[]}',
      "/products": '{"data":[{"id":1,"url":"https://rinnq.com/product/p1"}]}',
    });
    const client = new SallaClient({ fetchPage });

    expect(unwrap(await client.resolveStoreUrl(998616170))).toBe("https://rinnq.com/");
  });

  it("keeps the handle for a store hosted on a salla.sa path", async () => {
    const { fetchPage } = stub({
      "menus/header": '{"data":[{"url":"https://salla.sa/ravia/category/c1"}]}',
    });
    const client = new SallaClient({ fetchPage });

    expect(unwrap(await client.resolveStoreUrl(635160545))).toBe("https://salla.sa/ravia");
  });
});

describe("SallaClient marketplace", () => {
  it("collects every domain an app points at", async () => {
    const { fetchPage } = stub({ "/apps/1514900071": fixture("app-details") });
    const client = new SallaClient({ fetchPage });

    const details = unwrap(await client.fetchAppDetails("1514900071"));

    expect(details.id).toBe("1514900071");
    expect(details.name).not.toBe("");
    expect(details.domains.length).toBeGreaterThan(0);
    expect(details.domains.every((domain) => !domain.includes("/"))).toBe(true);
  });

  it("reads reviewers and the store behind each avatar", async () => {
    const { fetchPage } = stub({ "/reviews": fixture("app-reviews") });
    const client = new SallaClient({ fetchPage });

    const reviews = unwrap(await client.fetchAppReviews("1514900071", 1));

    expect(reviews.reviewers.length).toBeGreaterThan(0);
    expect(reviews.reviewers.every((reviewer) => reviewer.storeName !== "")).toBe(true);
    const identified = reviews.reviewers.filter((reviewer) => reviewer.storeId !== undefined);
    expect(identified.every((reviewer) => /^\d+$/.test(reviewer.storeId ?? ""))).toBe(true);
  });
});

describe("SallaClient catalogue", () => {
  it("pages through the catalogue and reuses the search token", async () => {
    const page = JSON.parse(fixture("catalog-page")) as { hits: unknown[] };
    const singlePage = JSON.stringify({ ...page, nbPages: 1 });
    const { fetchPage, calls } = stub({
      "users/search-token": fixture("search-token"),
      "algolia.net": singlePage,
    });
    const client = new SallaClient({ fetchPage });

    const first = unwrap(await client.fetchCatalog());
    const second = unwrap(await client.fetchCatalog());

    expect(first).toHaveLength(2);
    expect(first[0]?.id).toMatch(/^\d+$/);
    expect(second).toHaveLength(2);
    expect(calls.filter((call) => call.url.includes("search-token"))).toHaveLength(1);
  });

  it("requests a fresh token once the old one is close to expiring", async () => {
    const { fetchPage, calls } = stub({
      "users/search-token": fixture("search-token"),
      "algolia.net": JSON.stringify({ hits: [], nbPages: 1 }),
    });
    let now = new Date("2026-09-22T00:00:00Z");
    const client = new SallaClient({ fetchPage, now: () => now });

    await client.fetchCatalog();
    now = new Date("2026-10-30T00:00:00Z");
    await client.fetchCatalog();

    expect(calls.filter((call) => call.url.includes("search-token"))).toHaveLength(2);
  });
});

describe("SallaClient failures", () => {
  it("reports an unexpected response shape as drift, naming the endpoint", async () => {
    const { fetchPage } = stub({ "/products": '{"data":[{"id":1,"image":{"url":42}}]}' });
    const client = new SallaClient({ fetchPage });

    const result = await client.fetchProducts(1);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({ code: "schema-drift" });
  });

  it("reports a body that is not JSON", async () => {
    const { fetchPage } = stub({ "/apps/1": "<html>maintenance</html>" });
    const client = new SallaClient({ fetchPage });

    const result = await client.fetchAppDetails("1");

    expect(result.ok ? undefined : result.error).toMatchObject({ code: "invalid-json" });
  });

  it("reports an error status from the API", async () => {
    const { fetchPage } = stub({ "/apps/404": { status: 404, body: '{"status":404}' } });
    const client = new SallaClient({ fetchPage });

    const result = await client.fetchAppDetails("404");

    expect(result.ok ? undefined : result.error).toMatchObject({ code: "http", status: 404 });
  });
});
