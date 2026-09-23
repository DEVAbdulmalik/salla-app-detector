import { compileKnowledge } from "@salla-app-detector/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importSeed } from "../import-seed";
import type { Database } from "./executor";
import { migrate } from "./migrate";
import { createEmbeddedDatabase } from "./pglite";
import { KnowledgeRepository } from "./repository";

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

describe("migrations", () => {
  it("are recorded and never applied twice", async () => {
    const second = await migrate(database);

    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toContain("0001_knowledge_base");
  });

  it("protect every table with row level security", async () => {
    const rows = await database.query<{ relname: string }>(
      `select relname from pg_class
       where relkind = 'r' and relnamespace = 'public'::regnamespace
         and relname <> 'schema_migrations' and not relrowsecurity`,
    );

    expect(rows.map((row) => row.relname)).toEqual([]);
  });
});

describe("apps", () => {
  it("inserts and then updates the same app", async () => {
    await repository.upsertApps([
      { id: "1", name: "توليفاي", categories: ["التسويق"], installs: 10 },
    ]);
    await repository.upsertApps([{ id: "1", name: "توليفاي بلس", installs: 20 }]);

    const snapshot = await repository.loadSnapshot();

    expect(snapshot.apps["1"]).toMatchObject({ name: "توليفاي بلس", status: "listed" });
  });

  it("keeps a vendor we named ourselves out of the catalogue's reach", async () => {
    await repository.upsertApps([
      { id: "unknown:observer", name: "أوبزرفر", status: "unidentified" },
    ]);
    await repository.upsertApps([{ id: "unknown:observer", name: "أوبزرفر", status: "listed" }]);

    const snapshot = await repository.loadSnapshot();

    expect(snapshot.apps["unknown:observer"]?.status).toBe("unidentified");
  });

  it("marks an app as delisted only after it is missing twice", async () => {
    await repository.upsertApps([
      { id: "1", name: "still listed" },
      { id: "2", name: "about to disappear" },
    ]);

    expect(await repository.markAppsMissingFromCatalog(["1"])).toEqual(["2"]);
    expect((await repository.loadSnapshot()).apps["2"]?.status).toBe("listed");

    await repository.markAppsMissingFromCatalog(["1"]);

    expect((await repository.loadSnapshot()).apps["2"]?.status).toBe("delisted");
  });

  it("clears the missing count when an app comes back", async () => {
    await repository.upsertApps([{ id: "1", name: "app" }]);
    await repository.markAppsMissingFromCatalog([]);
    await repository.upsertApps([{ id: "1", name: "app" }]);
    await repository.markAppsMissingFromCatalog([]);

    expect((await repository.loadSnapshot()).apps["1"]?.status).toBe("listed");
  });

  it("hands out apps that were never fetched first, then the stalest", async () => {
    await repository.upsertApps([
      { id: "1", name: "one", installs: 5 },
      { id: "2", name: "two", installs: 500 },
    ]);
    await repository.saveAppDetails("2", ["tooliify.com"], new Date("2026-01-01T00:00:00Z"));

    const fresh = await repository.appsNeedingDetails(10, new Date("2025-01-01T00:00:00Z"));
    const stale = await repository.appsNeedingDetails(10, new Date("2026-06-01T00:00:00Z"));

    expect(fresh.map((app) => app.id)).toEqual(["1"]);
    expect(stale.map((app) => app.id)).toEqual(["1", "2"]);
  });
});

describe("fingerprints", () => {
  beforeEach(async () => {
    await repository.upsertApps([
      { id: "1", name: "app one" },
      { id: "2", name: "app two" },
    ]);
  });

  it("stores app and company targets and returns them in the snapshot", async () => {
    await repository.upsertFingerprints([
      {
        id: "domain:tooliify.com",
        kind: "domain",
        pattern: "tooliify.com",
        strength: "strong",
        source: "manual",
        appId: "1",
      },
      {
        id: "domain:studio.example",
        kind: "domain",
        pattern: "studio.example",
        strength: "strong",
        source: "auto",
        company: "Studio",
        companyAppIds: ["1", "2"],
      },
    ]);

    const snapshot = await repository.loadSnapshot();

    const byId = new Map(snapshot.fingerprints.map((item) => [item.id, item]));

    expect(snapshot.fingerprints).toHaveLength(2);
    expect(byId.get("domain:tooliify.com")?.target).toEqual({ type: "app", appId: "1" });
    expect(byId.get("domain:studio.example")?.target).toEqual({
      type: "company",
      company: "Studio",
      appIds: ["1", "2"],
    });
  });

  it("refuses a fingerprint that names both an app and a company", async () => {
    await expect(
      repository.upsertFingerprints([
        {
          id: "bad",
          kind: "domain",
          pattern: "x.example",
          strength: "strong",
          source: "manual",
          appId: "1",
          company: "Studio",
        },
      ]),
    ).rejects.toThrow();
  });

  it("replaces generated fingerprints without touching hand-written ones", async () => {
    await repository.upsertFingerprints([
      {
        id: "manual:a",
        kind: "domain",
        pattern: "a.example",
        strength: "strong",
        source: "manual",
        appId: "1",
      },
      {
        id: "auto:old",
        kind: "domain",
        pattern: "old.example",
        strength: "strong",
        source: "auto",
        appId: "1",
      },
      {
        id: "auto:kept",
        kind: "domain",
        pattern: "kept.example",
        strength: "strong",
        source: "auto",
        appId: "2",
      },
    ]);

    const removed = await repository.removeAutoFingerprints(["auto:kept"]);
    const snapshot = await repository.loadSnapshot();

    expect(removed).toBe(1);
    expect(snapshot.fingerprints.map((item) => item.id)).toEqual(["auto:kept", "manual:a"]);
  });

  it("leaves a disabled fingerprint out of the snapshot", async () => {
    await repository.upsertFingerprints([
      {
        id: "domain:off.example",
        kind: "domain",
        pattern: "off.example",
        strength: "strong",
        source: "manual",
        status: "disabled",
        appId: "1",
      },
    ]);

    expect((await repository.loadSnapshot()).fingerprints).toEqual([]);
  });
});

describe("snapshot", () => {
  it("groups noise rules by kind and changes version when knowledge changes", async () => {
    await repository.upsertNoiseRules([
      { kind: "domains", pattern: "googletagmanager.com" },
      { kind: "identifiers", pattern: "baseUrl" },
    ]);

    const before = await repository.loadSnapshot();
    await repository.upsertNoiseRules([{ kind: "domains", pattern: "sift.com" }]);
    const after = await repository.loadSnapshot();

    expect(before.noise.domains).toEqual(["googletagmanager.com"]);
    expect(before.noise.identifiers).toEqual(["baseUrl"]);
    expect(after.noise.domains).toEqual(["googletagmanager.com", "sift.com"]);
    expect(after.version).not.toBe(before.version);
    expect(after.version).toMatch(/^db-[0-9a-f]{8}$/);
  });

  it("produces knowledge the engine can compile", async () => {
    await importSeed(repository);

    const snapshot = await repository.loadSnapshot();
    const compiled = compileKnowledge(snapshot);

    expect(Object.keys(snapshot.apps).length).toBeGreaterThan(500);
    expect(snapshot.fingerprints.length).toBeGreaterThan(100);
    expect(compiled.exact.size).toBeGreaterThan(100);
  });
});

describe("job state", () => {
  it("remembers where a job stopped", async () => {
    await repository.saveJobState("catalog-sync", { offset: 200 }, "partial", new Date());

    const state = await repository.jobState("catalog-sync");

    expect(state?.cursor).toEqual({ offset: 200 });
    expect(state?.lastStatus).toBe("partial");
    expect(await repository.jobState("never-run")).toBeUndefined();
  });
});

describe("ground truth", () => {
  it("records stores known to run an app and ignores unknown apps", async () => {
    await repository.upsertApps([{ id: "1", name: "app" }]);

    await repository.recordGroundTruth([
      { appId: "1", storeId: 123, observedOn: "2026-09-01" },
      { appId: "missing", storeId: 456 },
    ]);

    const rows = await database.query<{ app_id: string; store_id: string }>(
      "select app_id, store_id from ground_truth",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.app_id).toBe("1");
  });
});

describe("scans and observations", () => {
  const report = { status: "live", apps: [{ appId: "1" }] };

  it("returns a recent scan and ignores an expired one", async () => {
    await repository.recordScan({
      storeHost: "mahwous.com",
      storeId: 986119567,
      status: "live",
      report,
      engineVersion: "1.0.0",
      knowledgeVersion: "db-1",
      durationMs: 900,
    });

    const fresh = await repository.recentScan("mahwous.com", 360);
    const expired = await repository.recentScan("mahwous.com", 0);
    const other = await repository.recentScan("other.com", 360);

    expect(fresh?.report).toEqual(report);
    expect(expired).toBeUndefined();
    expect(other).toBeUndefined();
  });

  it("keeps one row per signal and store, refreshing when seen again", async () => {
    await repository.recordObservations("a.com", [
      { kind: "domain", value: "vendor.example", sample: "script" },
    ]);
    await repository.recordObservations("a.com", [{ kind: "domain", value: "vendor.example" }]);
    await repository.recordObservations("b.com", [{ kind: "domain", value: "vendor.example" }]);

    const rows = await database.query<{ store_host: string; sample: string | null }>(
      "select store_host, sample from observations order by store_host",
    );

    expect(rows.map((row) => row.store_host)).toEqual(["a.com", "b.com"]);
    expect(rows[0]?.sample).toBe("script");
  });

  it("remembers the code Salla uses for a store's assets", async () => {
    await repository.rememberStoreCode("QNvEG", 986119567, "mahwous.com");
    await repository.rememberStoreCode("QNvEG", undefined, "mahwous.com");

    const rows = await database.query<{ store_id: string | number | null }>(
      "select store_id from store_codes where code = 'QNvEG'",
    );

    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.store_id)).toBe("986119567");
  });
});

describe("rate limiting", () => {
  it("allows requests up to the limit and refuses the rest", async () => {
    const attempts = [];
    for (let index = 0; index < 4; index += 1) {
      attempts.push(await repository.consumeRateLimit("ip:abc", 3, 60));
    }

    expect(attempts.map((attempt) => attempt.allowed)).toEqual([true, true, true, false]);
    expect(attempts[2]?.remaining).toBe(0);
  });

  it("counts each caller separately", async () => {
    await repository.consumeRateLimit("ip:one", 1, 60);
    const other = await repository.consumeRateLimit("ip:two", 1, 60);

    expect(other.allowed).toBe(true);
  });

  it("clears windows that have passed", async () => {
    await repository.consumeRateLimit("ip:abc", 5, 60);
    await repository.forgetOldRateLimits(0);

    const rows = await database.query("select 1 from rate_limits");
    expect(rows).toEqual([]);
  });
});

describe("published snapshot", () => {
  it("serves the assembled knowledge from a single row", async () => {
    await repository.upsertApps([{ id: "1", name: "app" }]);
    await repository.upsertFingerprints([
      {
        id: "domain:a.example",
        kind: "domain",
        pattern: "a.example",
        strength: "strong",
        source: "manual",
        appId: "1",
      },
    ]);

    const published = await repository.publishSnapshot();
    const read = await repository.readPublishedSnapshot();

    expect(read?.version).toBe(published.version);
    expect(read?.fingerprints).toHaveLength(1);
    expect(Object.keys(read?.apps ?? {})).toEqual(["1"]);
  });

  it("has nothing to serve before anything is published", async () => {
    expect(await repository.readPublishedSnapshot()).toBeUndefined();
  });

  it("keeps only the last few builds", async () => {
    for (const name of ["one", "two", "three", "four", "five"]) {
      await repository.upsertApps([{ id: name, name }]);
      await repository.publishSnapshot();
    }

    const rows = await database.query("select version from knowledge_snapshots");

    expect(rows).toHaveLength(3);
  });
});
