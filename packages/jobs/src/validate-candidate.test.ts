import { KnowledgeRepository, type Database } from "@salla-app-detector/knowledge";
import { migrate } from "@salla-app-detector/knowledge/migrate";
import { createEmbeddedDatabase } from "@salla-app-detector/knowledge/testing";
import { err, ok } from "@salla-app-detector/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateCandidate, type ValidationClient } from "./validate-candidate";

let database: Database;
let repository: KnowledgeRepository;

beforeEach(async () => {
  database = await createEmbeddedDatabase();
  await migrate(database);
  repository = new KnowledgeRepository(database);
  await repository.upsertApps([{ id: "app-1", name: "وِدجت" }]);
  await repository.publishSnapshot();
});

afterEach(async () => {
  await database.close();
});

const SIGNAL = { kind: "domain", value: "vendor.example" };

function storePage(withSignal: boolean): string {
  const vendor = withSignal ? '<script src="https://cdn.vendor.example/w.js"></script>' : "";
  return `<html><head><script src="https://cdn.salla.network/js/twilight/2.14.584/twilight.esm.js"></script></head>
    <body>${vendor}
    <script>salla.event.dispatchEvents(${JSON.stringify({ "twilight::init": { store: { id: 1 } } })})</script>
    </body></html>`;
}

function client(
  stores: Record<number, boolean | "unreachable">,
  codes: Record<string, boolean> = {},
): ValidationClient {
  const reviewers = [
    ...Object.keys(stores).map((id) => ({ reviewId: id, storeName: id, storeId: id })),
    ...Object.keys(codes).map((code) => ({ reviewId: code, storeName: code, storeCode: code })),
  ];
  return {
    fetchAppReviews: (_appId, page = 1) =>
      Promise.resolve(ok({ reviewers: page === 1 ? reviewers : [] })),
    resolveStoreUrl: (storeId) =>
      stores[storeId] === "unreachable"
        ? Promise.resolve(err("gone"))
        : Promise.resolve(ok(`https://store-${String(storeId)}.test/`)),
    fetchStorefront: (url) => {
      const code = /coded-([A-Za-z0-9]+)\.test/.exec(url)?.[1];
      const id = Number(/store-(\d+)/.exec(url)?.[1]);
      const carries = code === undefined ? stores[id] === true : codes[code] === true;
      return Promise.resolve(
        ok({
          status: 200,
          finalUrl: url,
          headers: {},
          body: storePage(carries),
          bytes: 0,
          redirects: [],
        }),
      );
    },
    fetchProducts: () => Promise.resolve(ok([])),
  };
}

async function baseline(signalStores: number, otherStores: number): Promise<void> {
  for (let index = 0; index < signalStores + otherStores; index += 1) {
    const host = `baseline-${String(index)}.test`;
    await repository.recordScan({
      storeKey: host,
      status: "live",
      report: {},
      engineVersion: "1.0.0",
      knowledgeVersion: "test",
      durationMs: 5,
    });
    if (index < signalStores) {
      await repository.recordObservations(host, [{ kind: SIGNAL.kind, value: SIGNAL.value }]);
    }
  }
}

describe("validateCandidate", () => {
  it("supports a signal that holds in the app's stores and is rare elsewhere", async () => {
    await baseline(1, 40);

    const result = await validateCandidate({
      repository,
      client: client({ 101: true, 102: true, 103: true, 104: false }),
      appId: "app-1",
      signalKind: SIGNAL.kind,
      signalValue: SIGNAL.value,
    });

    expect(result).toMatchObject({ storesChecked: 4, storesWithSignal: 3, verdict: "supported" });
    expect(result.groupShare).toBeCloseTo(0.75);
  });

  it("contradicts a signal that the app's own stores mostly lack", async () => {
    await baseline(0, 40);

    const result = await validateCandidate({
      repository,
      client: client({ 101: false, 102: false, 103: true, 104: false }),
      appId: "app-1",
      signalKind: SIGNAL.kind,
      signalValue: SIGNAL.value,
    });

    expect(result.verdict).toBe("contradicted");
  });

  it("refuses to conclude from a signal that is common everywhere", async () => {
    await baseline(30, 10);

    const result = await validateCandidate({
      repository,
      client: client({ 101: true, 102: true, 103: true }),
      appId: "app-1",
      signalKind: SIGNAL.kind,
      signalValue: SIGNAL.value,
    });

    expect(result.baselineShare).toBeGreaterThan(0.05);
    expect(result.verdict).toBe("inconclusive");
  });

  it("reaches reviewer stores whose avatar carries only a CDN code", async () => {
    await baseline(0, 30);
    await repository.rememberStoreCode("aBc12", undefined, "coded-aBc12.test");
    await repository.rememberStoreCode("dEf34", undefined, "coded-dEf34.test");

    const result = await validateCandidate({
      repository,
      client: client({ 101: true }, { aBc12: true, dEf34: true, unseen: true }),
      appId: "app-1",
      signalKind: SIGNAL.kind,
      signalValue: SIGNAL.value,
    });

    // The third code was never scanned, so it never becomes a store to check.
    expect(result).toMatchObject({ storesChecked: 3, verdict: "supported" });
  });

  it("reports the reviewer stores it could not reach", async () => {
    const result = await validateCandidate({
      repository,
      client: client({ 101: true, 102: "unreachable", 103: "unreachable" }),
      appId: "app-1",
      signalKind: SIGNAL.kind,
      signalValue: SIGNAL.value,
    });

    expect(result).toMatchObject({ storesChecked: 1, storesUnresolved: 2 });
  });

  it("refuses to conclude from too few stores", async () => {
    const result = await validateCandidate({
      repository,
      client: client({ 101: true, 102: "unreachable" }),
      appId: "app-1",
      signalKind: SIGNAL.kind,
      signalValue: SIGNAL.value,
    });

    expect(result).toMatchObject({ storesChecked: 1, verdict: "inconclusive" });
  });

  it("records the stores that carry the signal as known installations", async () => {
    await baseline(0, 20);

    await validateCandidate({
      repository,
      client: client({ 101: true, 102: true, 103: true }),
      appId: "app-1",
      signalKind: SIGNAL.kind,
      signalValue: SIGNAL.value,
    });

    const rows = await database.query<{ store_id: string }>(
      "select store_id::text from ground_truth where app_id = 'app-1' order by store_id",
    );
    expect(rows.map((row) => row.store_id)).toEqual(["101", "102", "103"]);
  });
});
