import { compileKnowledge, type ScanReport } from "@salla-app-detector/engine";
import {
  KnowledgeRepository,
  seedKnowledge,
  type Database,
  type ListedApp,
} from "@salla-app-detector/knowledge";
import { migrate } from "@salla-app-detector/knowledge/migrate";
import { createEmbeddedDatabase } from "@salla-app-detector/knowledge/testing";
import type { AppReviewer } from "@salla-app-detector/salla";
import { err, ok } from "@salla-app-detector/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harvestableApps, harvestReviewerStores, type HarvestClient } from "./harvest";
import type { ScanOutcome } from "./scan-store";

let database: Database;
let repository: KnowledgeRepository;
const knowledge = compileKnowledge(seedKnowledge);

beforeEach(async () => {
  database = await createEmbeddedDatabase();
  await migrate(database);
  repository = new KnowledgeRepository(database);
  await repository.upsertApps([
    { id: "a", name: "وِدجت", installs: 100 },
    { id: "b", name: "نافذة", installs: 50 },
  ]);
});

afterEach(async () => {
  await database.close();
});

const APP_A: ListedApp = { id: "a", name: "وِدجت", categories: [], isDefault: false };
const APP_B: ListedApp = { id: "b", name: "نافذة", categories: [], isDefault: false };

function reviewer(fields: Partial<AppReviewer>): AppReviewer {
  return { reviewId: String(Math.random()), storeName: "store", ...fields };
}

function client(reviews: Record<string, AppReviewer[] | "fails">): HarvestClient {
  return {
    fetchAppReviews: (appId) => {
      const found = reviews[appId] ?? [];
      return Promise.resolve(
        found === "fails"
          ? err({ code: "http", status: 500, endpoint: "reviews" })
          : ok({ reviewers: found }),
      );
    },
    resolveStoreUrl: (storeId) => Promise.resolve(ok(`https://store-${String(storeId)}.test/`)),
    fetchStorefront: () => Promise.reject(new Error("scans are stubbed")),
    fetchProducts: () => Promise.reject(new Error("scans are stubbed")),
  };
}

/** Answers each store with the status it is pretending to have, and remembers who asked. */
function scanner(statuses: Record<number, string> = {}, onScan?: () => void) {
  const scanned: number[] = [];
  const scan = (url: string) => {
    const id = Number(/store-(\d+)/.exec(url)?.[1]);
    scanned.push(id);
    onScan?.();
    const status = statuses[id] ?? "live";
    const host = new URL(url).hostname;
    const report = {
      target: { url, host, key: host },
      status,
      ...(status === "live" ? { store: { id } } : {}),
      apps: [],
      dropshipping: [],
      integrations: [],
      payments: { methods: [], installments: [] },
      unknownSignals: [],
      meta: { engineVersion: "1.0.0", knowledgeVersion: "test" },
    } as unknown as ScanReport;
    return Promise.resolve(
      ok({ report, target: { url, host, key: host } } as unknown as ScanOutcome),
    );
  };
  return { scan, scanned };
}

async function groundTruth(): Promise<{ app_id: string; store_id: string; observed_on: string }[]> {
  return database.query(
    `select app_id, store_id::text as store_id, observed_on::text as observed_on
     from ground_truth order by app_id, store_id`,
  );
}

describe("harvestReviewerStores", () => {
  it("files every reviewer store as an installation and scans the ones not seen lately", async () => {
    await repository.rememberStoreCode("QNvEG", 4, "store-4.test");
    await repository.recordScan({
      storeKey: "store-3.test",
      storeId: 3,
      status: "live",
      report: {},
      engineVersion: "1.0.0",
      knowledgeVersion: "test",
      durationMs: 5,
    });
    const { scan, scanned } = scanner({ 2: "maintenance" });

    const result = await harvestReviewerStores({
      repository,
      knowledge,
      apps: [APP_A],
      scan,
      client: client({
        a: [
          reviewer({ storeId: "1", date: "2026-09-20" }),
          reviewer({ storeId: "2" }),
          reviewer({ storeId: "3" }),
          reviewer({ storeCode: "QNvEG" }),
          reviewer({ storeCode: "unknown" }),
          reviewer({}),
        ],
      }),
    });

    expect(result.apps).toEqual([
      {
        appId: "a",
        name: "وِدجت",
        reviewers: 6,
        knownStores: 4,
        alreadyScanned: 1,
        scanned: { live: 2, maintenance: 1 },
      },
    ]);
    expect(scanned.sort()).toEqual([1, 2, 4]);
    expect(await groundTruth()).toEqual([
      { app_id: "a", store_id: "1", observed_on: "2026-09-20" },
      { app_id: "a", store_id: "2", observed_on: null },
      { app_id: "a", store_id: "3", observed_on: null },
      { app_id: "a", store_id: "4", observed_on: null },
    ]);
    // A store under maintenance has no configuration to name it, yet it still counts as visited.
    expect(await repository.recentlyScannedStoreIds([2], 1)).toEqual(new Set([2]));
  });

  it("scans only as many stores as an app still needs", async () => {
    await repository.recordScan({
      storeKey: "store-1.test",
      storeId: 1,
      status: "live",
      report: {},
      engineVersion: "1.0.0",
      knowledgeVersion: "test",
      durationMs: 5,
    });
    const { scan, scanned } = scanner();

    await harvestReviewerStores({
      repository,
      knowledge,
      apps: [APP_A],
      scan,
      storesPerApp: 2,
      client: client({ a: ["1", "2", "3", "4"].map((storeId) => reviewer({ storeId })) }),
    });

    expect(scanned).toEqual([2]);
  });

  it("does not fetch a store twice when several apps share it", async () => {
    const { scan, scanned } = scanner({ 1: "maintenance" });

    await harvestReviewerStores({
      repository,
      knowledge,
      apps: [APP_A, APP_B],
      scan,
      client: client({
        a: [reviewer({ storeId: "1" })],
        b: [reviewer({ storeId: "1" }), reviewer({ storeId: "2" })],
      }),
    });

    expect(scanned).toEqual([1, 2]);
    expect((await groundTruth()).map((row) => `${row.app_id}:${row.store_id}`)).toEqual([
      "a:1",
      "b:1",
      "b:2",
    ]);
  });

  it("passes over an app it finished recently", async () => {
    const reviews = client({ a: [reviewer({ storeId: "1" })] });
    await harvestReviewerStores({
      repository,
      knowledge,
      apps: [APP_A],
      ...scanner(),
      client: reviews,
    });

    const { scan, scanned } = scanner();
    const second = await harvestReviewerStores({
      repository,
      knowledge,
      apps: [APP_A],
      scan,
      client: reviews,
    });

    expect(second).toMatchObject({ apps: [], remaining: 0 });
    expect(scanned).toEqual([]);
  });

  it("stops at the time budget and picks the unfinished app up next time", async () => {
    let clock = Date.parse("2026-09-25T10:00:00Z");
    const now = () => new Date(clock);
    const reviews = client({ a: ["1", "2", "3"].map((storeId) => reviewer({ storeId })) });
    const first = scanner({}, () => {
      clock += 10 * 60 * 1000;
    });

    const partial = await harvestReviewerStores({
      repository,
      knowledge,
      apps: [APP_A],
      client: reviews,
      scan: first.scan,
      workers: 1,
      budgetMs: 15 * 60 * 1000,
      now,
    });

    expect(partial).toMatchObject({ stopped: "budget", remaining: 1 });
    expect(first.scanned).toEqual([1, 2]);

    const second = scanner();
    const rest = await harvestReviewerStores({
      repository,
      knowledge,
      apps: [APP_A],
      client: reviews,
      scan: second.scan,
      now,
    });

    expect(rest).toMatchObject({ remaining: 0 });
    expect(rest.stopped).toBeUndefined();
    expect(second.scanned).toEqual([3]);
  });

  it("stops once the stores keep refusing", async () => {
    const ids = ["1", "2", "3", "4", "5", "6", "7"];
    const { scan, scanned } = scanner(Object.fromEntries(ids.map((id) => [id, "blocked"])));

    const result = await harvestReviewerStores({
      repository,
      knowledge,
      apps: [APP_A],
      scan,
      workers: 1,
      client: client({ a: ids.map((storeId) => reviewer({ storeId })) }),
    });

    expect(result).toMatchObject({ stopped: "refused", remaining: 1 });
    expect(scanned).toHaveLength(5);
  });

  it("tries an app again when its reviews could not be read", async () => {
    const result = await harvestReviewerStores({
      repository,
      knowledge,
      apps: [APP_A],
      ...scanner(),
      client: client({ a: "fails" }),
    });

    expect(result.apps[0]?.reviewsFailed).toBe("http");
    expect(result.remaining).toBe(1);
  });
});

describe("harvestableApps", () => {
  it("keeps apps that could leave a trace on the storefront", () => {
    const apps: ListedApp[] = [
      { id: "shipping", name: "شحن", categories: ["الشحن و التوصيل"], isDefault: false },
      { id: "mixed", name: "مختلط", categories: ["الشحن و التوصيل", "التسويق"], isDefault: false },
      { id: "default", name: "افتراضي", categories: ["التسويق"], isDefault: true },
      { id: "plain", name: "بدون تصنيف", categories: [], isDefault: false },
    ];

    expect(harvestableApps(apps).map((app) => app.id)).toEqual(["mixed", "plain"]);
  });
});
