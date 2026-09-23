import {
  compileKnowledge,
  type CompiledKnowledge,
  type ScanReport,
} from "@salla-app-detector/engine";
import { KnowledgeRepository, seedKnowledge, type Database } from "@salla-app-detector/knowledge";
import { migrate } from "@salla-app-detector/knowledge/migrate";
import { createEmbeddedDatabase } from "@salla-app-detector/knowledge/testing";
import { ok } from "@salla-app-detector/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { health } from "./health";
import type { ScanClient, ScanOutcome } from "./scan-store";

let database: Database;
let repository: KnowledgeRepository;
let knowledge: CompiledKnowledge;

beforeEach(async () => {
  database = await createEmbeddedDatabase();
  await migrate(database);
  repository = new KnowledgeRepository(database);
  knowledge = compileKnowledge(seedKnowledge);
});

afterEach(async () => {
  await database.close();
});

const client = {} as ScanClient;

/** Stands in for a scan: each store answers with the apps it is pretending to run. */
function scanner(stores: Record<string, string[] | "unreachable">) {
  return (url: string) => {
    const found = stores[url];
    if (found === undefined || found === "unreachable") {
      return Promise.resolve(
        ok({
          report: reportFor(url, [], "blocked"),
          target: { url, host: new URL(url).hostname },
        } as ScanOutcome),
      );
    }
    return Promise.resolve(
      ok({
        report: reportFor(url, found, "live"),
        target: { url, host: new URL(url).hostname },
      } as ScanOutcome),
    );
  };
}

function reportFor(url: string, appIds: readonly string[], status: string): ScanReport {
  return {
    target: { url, host: new URL(url).hostname },
    status,
    apps: appIds.map((appId) => ({ appId, name: appId, confidence: "confirmed", evidence: [] })),
    integrations: [],
    payments: { methods: [], installments: [] },
    unknownSignals: [],
    meta: { engineVersion: "1.0.0", knowledgeVersion: "test", scannedAt: "2026-01-01T00:00:00Z" },
  } as unknown as ScanReport;
}

async function scansWithStatus(status: string, count: number, offset = 0): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await repository.recordScan({
      storeHost: `${status}-${String(index + offset)}.test`,
      status,
      report: {},
      engineVersion: "1.0.0",
      knowledgeVersion: "test",
      durationMs: 5,
    });
  }
}

describe("health", () => {
  it("reports a canary that lost one of its apps", async () => {
    await repository.upsertCanaries([
      { storeUrl: "https://one.test/", expectedAppIds: ["a", "b"], expectedServices: [] },
      { storeUrl: "https://two.test/", expectedAppIds: ["a"], expectedServices: [] },
    ]);

    const result = await health({
      repository,
      client,
      knowledge,
      scan: scanner({ "https://one.test/": ["a"], "https://two.test/": ["a"] }),
    });

    expect(result).toMatchObject({ canariesChecked: 2, canariesIntact: 1 });
    expect(result.events).toEqual([
      {
        kind: "canary-missing-app",
        severity: "warning",
        detail: { store: "https://one.test/", appIds: ["b"] },
      },
    ]);
  });

  it("treats several canaries losing apps at once as a platform change", async () => {
    await repository.upsertCanaries(
      ["one", "two", "three", "four"].map((name) => ({
        storeUrl: `https://${name}.test/`,
        expectedAppIds: ["a"],
        expectedServices: [],
      })),
    );

    const result = await health({
      repository,
      client,
      knowledge,
      scan: scanner({
        "https://one.test/": [],
        "https://two.test/": [],
        "https://three.test/": [],
        "https://four.test/": ["a"],
      }),
    });

    expect(result.events.map((event) => [event.kind, event.severity])).toEqual([
      ["canary-sweep", "critical"],
    ]);
  });

  it("raises an alert when too many scans come back blocked", async () => {
    await scansWithStatus("live", 20);
    await scansWithStatus("blocked", 10);

    const result = await health({ repository, client, knowledge, scan: scanner({}) });
    const blocked = result.events.find((event) => event.kind === "blocked-rate");

    expect(blocked?.severity).toBe("critical");
    expect(blocked?.detail).toMatchObject({ blocked: 10, scanned: 30 });
  });

  it("stays quiet while there are too few scans to judge a rate", async () => {
    await scansWithStatus("blocked", 5);

    const result = await health({ repository, client, knowledge, scan: scanner({}) });

    expect(result.events.some((event) => event.kind === "blocked-rate")).toBe(false);
  });

  it("notices an app that stopped being detected this week", async () => {
    await repository.upsertApps([{ id: "app-1", name: "widget" }]);
    for (const index of [0, 1, 2]) {
      await database.query(
        `insert into scans (store_host, status, report, engine_version, knowledge_version, duration_ms, scanned_at)
         values ($1, 'live', $2::text::jsonb, '1.0.0', 'test', 5, now() - interval '10 days')`,
        [`old-${String(index)}.test`, JSON.stringify({ apps: [{ appId: "app-1" }] })],
      );
    }
    await scansWithStatus("live", 3);

    const result = await health({ repository, client, knowledge, scan: scanner({}) });
    const silent = result.events.find((event) => event.kind === "fingerprint-silent");

    expect(silent?.detail).toEqual({ apps: [{ appId: "app-1", was: 3 }] });
  });

  it("keeps the events it raised", async () => {
    await repository.upsertCanaries([
      { storeUrl: "https://one.test/", expectedAppIds: ["a"], expectedServices: [] },
    ]);

    await health({ repository, client, knowledge, scan: scanner({}) });

    const events = await repository.recentHealthEvents(5);
    expect(events.map((event) => event.kind)).toEqual(["canary-unreachable"]);
    expect((await repository.jobState("health"))?.lastStatus).toBe("completed");
  });
});
