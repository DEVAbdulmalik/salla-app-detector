import { KnowledgeRepository, type Database } from "@salla-app-detector/knowledge";
import { migrate } from "@salla-app-detector/knowledge/migrate";
import { createEmbeddedDatabase } from "@salla-app-detector/knowledge/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { learn } from "./learn";

let database: Database;
let repository: KnowledgeRepository;

beforeEach(async () => {
  database = await createEmbeddedDatabase();
  await migrate(database);
  repository = new KnowledgeRepository(database);
});

afterEach(async () => {
  await database.close();
});

async function observe(signalValue: string, stores: readonly string[], kind = "domain") {
  for (const store of stores) {
    await repository.recordObservations(store, [
      { kind, value: signalValue, sample: "seen in a script" },
    ]);
  }
}

/** A scan that reports which theme the store runs, which is what ties a trace to a theme. */
async function recordThemedScan(storeKey: string, themeId: string): Promise<void> {
  await repository.recordScan({
    storeKey,
    status: "live",
    report: { store: { theme: themeId } },
    engineVersion: "1.0.0",
    knowledgeVersion: "test",
    durationMs: 5,
  });
}

async function recordScans(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await repository.recordScan({
      storeKey: `store-${String(index)}.test`,
      status: "live",
      report: {},
      engineVersion: "1.0.0",
      knowledgeVersion: "test",
      durationMs: 10,
    });
  }
}

const stores = (count: number): string[] =>
  Array.from({ length: count }, (_value, index) => `store-${String(index)}.test`);

describe("learn", () => {
  it("promotes a signal seen across enough stores to a candidate", async () => {
    await observe("vendor.example", stores(6));
    await observe("rare.example", stores(2));

    const result = await learn({ repository });
    const candidates = await repository.listCandidates("new");

    expect(result.candidates).toBe(1);
    expect(candidates.map((candidate) => candidate.signalValue)).toEqual(["vendor.example"]);
    expect(candidates[0]?.storeCount).toBe(6);
  });

  it("names the app when the signal sits on a vendor's own domain", async () => {
    await repository.upsertApps([{ id: "42", name: "توليفاي" }]);
    await repository.saveAppDetails("42", ["tooliify.com"], new Date());
    await observe("files.tooliify.com", stores(5), "host");

    const result = await learn({ repository });
    const [candidate] = await repository.listCandidates("new");

    expect(result.attributed).toBe(1);
    expect(candidate).toMatchObject({ suggestedAppId: "42", suggestedAppName: "توليفاي" });
  });

  it("leaves a domain shared by several apps for a person to decide", async () => {
    await repository.upsertApps([
      { id: "1", name: "one" },
      { id: "2", name: "two" },
    ]);
    await repository.saveAppDetails("1", ["studio.example"], new Date());
    await repository.saveAppDetails("2", ["studio.example"], new Date());
    await observe("studio.example", stores(5));

    const result = await learn({ repository });

    expect(result.attributed).toBe(0);
    expect((await repository.listCandidates("new"))[0]?.suggestedAppId).toBeUndefined();
  });

  it("records a signal seen on nearly every store as platform background", async () => {
    await recordScans(120);
    await observe("everywhere.example", stores(110));
    await observe("vendor.example", stores(8));

    const result = await learn({ repository });
    const snapshot = await repository.loadSnapshot();

    expect(result.noiseRulesAdded).toEqual(["everywhere.example"]);
    expect(snapshot.noise.domains).toContain("everywhere.example");
    expect((await repository.listCandidates("new")).map((row) => row.signalValue)).toEqual([
      "vendor.example",
    ]);
  });

  it("waits for enough scans before calling anything platform background", async () => {
    await recordScans(10);
    await observe("everywhere.example", stores(10));

    const result = await learn({ repository });

    expect(result.noiseRulesAdded).toEqual([]);
  });

  it("raises an alert for an integration key it cannot map", async () => {
    await observe("brand_new_pixel", stores(5), "service");

    const result = await learn({ repository });
    const events = await database.query<{ kind: string; severity: string }>(
      "select kind, severity from health_events",
    );

    expect(result.newServiceKeys).toEqual(["brand_new_pixel"]);
    expect(events[0]).toMatchObject({ kind: "unmapped-service-key", severity: "warning" });
  });

  it("reports an integration key once, not on every run", async () => {
    await observe("brand_new_pixel", stores(5), "service");

    const first = await learn({ repository });
    const second = await learn({ repository });
    const events = await database.query<{ n: string }>(
      "select count(*)::text as n from health_events where kind = 'unmapped-service-key'",
    );

    expect(first.newServiceKeys).toEqual(["brand_new_pixel"]);
    expect(second.newServiceKeys).toEqual([]);
    expect(events[0]?.n).toBe("1");
  });

  it("recognises a trace that belongs to a theme rather than to an app", async () => {
    await repository.upsertThemes([{ id: "632105401", name: "سيليا", developer: "Selia Tech" }]);
    for (const index of [0, 1, 2, 3, 4]) {
      await recordThemedScan(`store-${String(index)}.test`, "632105401");
    }
    await observe("selia-tech.com", stores(5));

    const result = await learn({ repository });
    const [candidate] = await repository.listCandidates("new");

    expect(result.themeAssets).toBe(1);
    expect(candidate).toMatchObject({ themeId: "632105401", themeName: "سيليا" });
  });

  it("leaves a trace spread across themes to be judged as an app", async () => {
    await repository.upsertThemes([
      { id: "a", name: "ثيم أ" },
      { id: "b", name: "ثيم ب" },
    ]);
    for (const index of [0, 1, 2]) {
      await recordThemedScan(`store-${String(index)}.test`, "a");
    }
    for (const index of [3, 4]) {
      await recordThemedScan(`store-${String(index)}.test`, "b");
    }
    await observe("vendor.example", stores(5));

    const result = await learn({ repository });

    // Merchants install an app whatever their store looks like, so a spread means an app.
    expect(result.themeAssets).toBe(0);
    expect((await repository.listCandidates("new"))[0]?.themeId).toBeUndefined();
  });

  it("keeps a decision a person already made", async () => {
    await observe("vendor.example", stores(5));
    await learn({ repository });
    await repository.setCandidateStatus("domain", "vendor.example", "ignored");

    await observe("vendor.example", [...stores(5), "extra.test"]);
    await learn({ repository });

    expect(await repository.listCandidates("new")).toEqual([]);
    expect((await repository.listCandidates("ignored"))[0]?.storeCount).toBe(6);
  });

  it("remembers that it ran", async () => {
    await learn({ repository });

    expect((await repository.jobState("learn"))?.lastStatus).toBe("completed");
  });
});
