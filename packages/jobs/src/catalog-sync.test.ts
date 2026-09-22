import { createEmbeddedDatabase } from "@salla-app-detector/knowledge/testing";
import { KnowledgeRepository, type Database } from "@salla-app-detector/knowledge";
import { migrate } from "@salla-app-detector/knowledge/migrate";
import type { ApiFailure, AppDetails, CatalogApp } from "@salla-app-detector/salla";
import { err, ok, type Result } from "@salla-app-detector/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncCatalog, type CatalogClient } from "./catalog-sync";

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

function catalogApp(id: string, overrides: Partial<CatalogApp> = {}): CatalogApp {
  return {
    id,
    name: `app ${id}`,
    categories: [],
    isSalla: false,
    ...overrides,
  };
}

function details(id: string, domains: string[], company?: string): AppDetails {
  return {
    id,
    name: `app ${id}`,
    categories: [],
    domains,
    ...(company === undefined ? {} : { companyName: company }),
  };
}

function stubClient(
  catalog: CatalogApp[],
  detailsById: Record<string, AppDetails | ApiFailure>,
): { client: CatalogClient; detailCalls: string[] } {
  const detailCalls: string[] = [];
  const client: CatalogClient = {
    fetchCatalog: () => Promise.resolve(ok(catalog) as Result<CatalogApp[], ApiFailure>),
    fetchAppDetails: (appId) => {
      detailCalls.push(appId);
      const entry = detailsById[appId];
      if (entry === undefined) {
        return Promise.resolve(err({ code: "http", status: 404, endpoint: `/apps/${appId}` }));
      }
      return Promise.resolve(
        "domains" in entry ? ok(entry) : (err(entry) as Result<AppDetails, ApiFailure>),
      );
    },
  };
  return { client, detailCalls };
}

describe("syncCatalog", () => {
  it("stores the catalogue and derives a fingerprint from each developer domain", async () => {
    const { client } = stubClient(
      [catalogApp("1", { company: "Tooliify" }), catalogApp("2", { company: "Matajer" })],
      {
        "1": details("1", ["files.tooliify.com", "tooliify.com"], "Tooliify"),
        "2": details("2", ["app.matajertech.com"], "Matajer"),
      },
    );

    const result = await syncCatalog({ client, repository });

    if (!result.ok) {
      throw new Error(`sync failed: ${result.error.code}`);
    }
    expect(result.value).toMatchObject({ catalogApps: 2, detailsFetched: 2, completed: true });

    const snapshot = await repository.loadSnapshot();
    const patterns = snapshot.fingerprints.map((item) => item.pattern).sort();
    expect(patterns).toEqual(["matajertech.com", "tooliify.com"]);
    expect(snapshot.fingerprints[0]?.target).toEqual({ type: "app", appId: "2" });
  });

  it("names the company when one domain covers several of its apps", async () => {
    const { client } = stubClient([catalogApp("1"), catalogApp("2")], {
      "1": details("1", ["studio.example"], "Studio"),
      "2": details("2", ["studio.example"], "Studio"),
    });

    await syncCatalog({ client, repository });

    const snapshot = await repository.loadSnapshot();
    expect(snapshot.fingerprints).toHaveLength(1);
    expect(snapshot.fingerprints[0]?.target).toEqual({
      type: "company",
      company: "Studio",
      appIds: ["1", "2"],
    });
  });

  it("skips domains that identify nothing", async () => {
    await repository.upsertNoiseRules([{ kind: "domains", pattern: "hotjar.com" }]);
    const { client } = stubClient([catalogApp("1"), catalogApp("2"), catalogApp("3")], {
      "1": details("1", ["facebook.com", "wa.me"]),
      "2": details("2", ["lenkwhats.pages.dev"]),
      "3": details("3", ["hotjar.com"]),
    });

    await syncCatalog({ client, repository });

    expect((await repository.loadSnapshot()).fingerprints).toEqual([]);
  });

  it("marks an app that disappeared from the catalogue, keeping its record", async () => {
    await repository.upsertApps([{ id: "gone", name: "delisted app" }]);
    const { client } = stubClient([catalogApp("1")], { "1": details("1", []) });

    await syncCatalog({ client, repository });
    const second = await syncCatalog({ client, repository });

    expect(second.ok && second.value.newlyDelisted).toContain("gone");
    const snapshot = await repository.loadSnapshot();
    expect(snapshot.apps.gone?.status).toBe("delisted");
  });

  it("stops at the time budget and reports that it has more to do", async () => {
    const { client, detailCalls } = stubClient(
      [catalogApp("1"), catalogApp("2"), catalogApp("3")],
      {
        "1": details("1", ["one.example"]),
        "2": details("2", ["two.example"]),
        "3": details("3", ["three.example"]),
      },
    );
    let clock = Date.parse("2026-09-22T00:00:00Z");
    const now = (): Date => {
      clock += 400;
      return new Date(clock);
    };

    const result = await syncCatalog({ client, repository, budgetMs: 500, now });

    expect(detailCalls.length).toBeLessThan(3);
    expect(result.ok && result.value.completed).toBe(false);
    expect((await repository.jobState("catalog-sync"))?.lastStatus).toBe("partial");
  });

  it("carries on when one app's details cannot be read", async () => {
    const { client } = stubClient([catalogApp("1"), catalogApp("2")], {
      "1": details("1", ["one.example"]),
    });

    const result = await syncCatalog({ client, repository });

    expect(result.ok && result.value).toMatchObject({ detailsFetched: 1, detailsFailed: 1 });
    expect((await repository.loadSnapshot()).fingerprints).toHaveLength(1);
  });

  it("drops a generated fingerprint once the vendor stops using that domain", async () => {
    const first = stubClient([catalogApp("1")], { "1": details("1", ["old.example"]) });
    await syncCatalog({ client: first.client, repository });

    const second = stubClient([catalogApp("1")], { "1": details("1", ["new.example"]) });
    const result = await syncCatalog({
      client: second.client,
      repository,
      detailsMaxAgeDays: 0,
    });

    expect(result.ok && result.value.fingerprintsRemoved).toBe(1);
    expect((await repository.loadSnapshot()).fingerprints.map((item) => item.pattern)).toEqual([
      "new.example",
    ]);
  });

  it("keeps existing fingerprints while the details backfill is still running", async () => {
    await repository.upsertApps([{ id: "1", name: "one" }]);
    await repository.upsertFingerprints([
      {
        id: "dev-domain:known.example",
        kind: "domain",
        pattern: "known.example",
        strength: "strong",
        source: "auto",
        appId: "1",
      },
    ]);
    const { client } = stubClient([catalogApp("1"), catalogApp("2")], {
      "1": details("1", ["fresh.example"]),
      "2": details("2", ["later.example"]),
    });

    const result = await syncCatalog({ client, repository, detailsPerRun: 1 });

    expect(result.ok && result.value).toMatchObject({ completed: false, fingerprintsRemoved: 0 });
    expect(
      (await repository.loadSnapshot()).fingerprints.map((item) => item.pattern).sort(),
    ).toEqual(["fresh.example", "known.example"]);
  });

  it("reports a catalogue that could not be read", async () => {
    const client: CatalogClient = {
      fetchCatalog: () =>
        Promise.resolve(
          err({ code: "schema-drift", endpoint: "/query", issues: ["hits: missing"] }),
        ),
      fetchAppDetails: () => Promise.reject(new Error("not reached")),
    };

    const result = await syncCatalog({ client, repository });

    expect(result.ok).toBe(false);
    expect((await repository.jobState("catalog-sync"))?.lastStatus).toContain("catalog-failed");
  });
});
