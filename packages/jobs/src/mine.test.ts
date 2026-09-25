import { KnowledgeRepository, type Database } from "@salla-app-detector/knowledge";
import { migrate } from "@salla-app-detector/knowledge/migrate";
import { createEmbeddedDatabase } from "@salla-app-detector/knowledge/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mineAppSignals } from "./mine";

let database: Database;
let repository: KnowledgeRepository;

interface StoreShape {
  readonly apps?: readonly { appId: string; evidence: { kind: string; value: string }[] }[];
  readonly unknown?: readonly { kind: string; value: string }[];
}

async function store(id: number, shape: StoreShape = {}): Promise<void> {
  await repository.recordScan({
    storeKey: `store-${String(id)}.test`,
    storeId: id,
    status: "live",
    report: {
      apps: shape.apps ?? [],
      dropshipping: [],
      integrations: [],
      unknownSignals: shape.unknown ?? [],
    },
    engineVersion: "1.0.0",
    knowledgeVersion: "test",
    durationMs: 5,
  });
}

/**
 * Stores 1-3 run the widget and, as it happens, a second app from the same merchants;
 * stores 4-6 run an app with a trace nobody has named; stores 7-10 run an app that shows
 * nothing at all.
 */
beforeEach(async () => {
  database = await createEmbeddedDatabase();
  await migrate(database);
  repository = new KnowledgeRepository(database);

  await repository.upsertApps(
    ["widget", "sibling", "lead", "silent", "other"].map((id) => ({ id, name: id })),
  );
  await repository.upsertFingerprints([
    {
      id: "manual:domain:own.example",
      kind: "domain",
      pattern: "own.example",
      strength: "strong",
      source: "manual",
      appId: "widget",
    },
    {
      id: "manual:domain:other.example",
      kind: "domain",
      pattern: "other.example",
      strength: "strong",
      source: "manual",
      appId: "other",
    },
  ]);

  for (const id of [1, 2, 3]) {
    await store(id, {
      apps: [
        { appId: "widget", evidence: [{ kind: "domain", value: "own.example" }] },
        { appId: "other", evidence: [{ kind: "domain", value: "other.example" }] },
      ],
      unknown: [{ kind: "domain", value: "both.example" }],
    });
  }
  await store(4, { unknown: [{ kind: "inline-signature", value: "abcd1234" }] });
  await store(5, { unknown: [{ kind: "inline-signature", value: "abcd1234" }] });
  for (const id of [6, 7, 8, 9, 10]) {
    await store(id);
  }

  await repository.recordGroundTruth([
    ...[1, 2, 3].flatMap((storeId) => [
      { appId: "widget", storeId },
      { appId: "sibling", storeId },
    ]),
    ...[4, 5, 6].map((storeId) => ({ appId: "lead", storeId })),
    ...[7, 8, 9, 10].map((storeId) => ({ appId: "silent", storeId })),
    // A reviewer whose store no live scan has seen says nothing yet.
    { appId: "lead", storeId: 99 },
  ]);
});

afterEach(async () => {
  await database.close();
});

const SMALL = { minStores: 3, minSupport: 2, noTraceStores: 4 } as const;

describe("mineAppSignals", () => {
  it("tells an app's own fingerprint from another app's and from a new lead", async () => {
    const result = await mineAppSignals({ repository, ...SMALL });

    expect(result.liveStores).toBe(10);
    expect(result.apps.find((app) => app.appId === "widget")).toEqual({
      appId: "widget",
      stores: 3,
      detected: 3,
      verdict: "detected",
      signals: [
        {
          kind: "domain",
          value: "both.example",
          groupStores: 3,
          baselineShare: 0,
          standing: "shared",
          sharedWith: ["sibling"],
        },
        {
          kind: "domain",
          value: "own.example",
          groupStores: 3,
          baselineShare: 0,
          standing: "known",
        },
        {
          kind: "domain",
          value: "other.example",
          groupStores: 3,
          baselineShare: 0,
          standing: "shared",
          sharedWith: ["other"],
        },
      ].sort((left, right) => left.value.localeCompare(right.value)),
    });
  });

  it("proposes a trace only the app's stores carry, with the evidence behind it", async () => {
    const result = await mineAppSignals({ repository, ...SMALL });

    expect(result.candidates).toEqual([
      {
        signalKind: "inline-signature",
        signalValue: "abcd1234",
        appId: "lead",
        groupStores: 2,
        groupSize: 3,
        baselineShare: 0,
      },
    ]);
    expect(result.queued).toBe(1);
    const [queued] = await repository.listCandidates("new");
    expect(queued).toMatchObject({
      signalValue: "abcd1234",
      suggestedAppId: "lead",
      evidence: { appId: "lead", groupStores: 2, groupSize: 3, baselineShare: 0 },
    });
  });

  it("calls an app traceless only when enough of its stores show nothing", async () => {
    const result = await mineAppSignals({ repository, ...SMALL });
    const verdicts = Object.fromEntries(result.apps.map((app) => [app.appId, app.verdict]));

    expect(verdicts).toEqual({
      widget: "detected",
      silent: "no-trace",
      lead: "unclear",
      // Three stores are too few to call it traceless.
      sibling: "unclear",
    });
    const saved = await database.query<{ app_id: string; verdict: string }>(
      "select app_id, verdict from app_quality order by app_id",
    );
    expect(saved).toHaveLength(4);
  });

  it("leaves a trace a person already ignored where it is", async () => {
    await repository.upsertCandidates([
      { signalKind: "inline-signature", signalValue: "abcd1234", storeCount: 2 },
    ]);
    await repository.setCandidateStatus("inline-signature", "abcd1234", "ignored");

    await mineAppSignals({ repository, ...SMALL });

    const result = await mineAppSignals({ repository, ...SMALL });

    expect(result).toMatchObject({ queued: 0 });
    expect(result.candidates).toHaveLength(1);
    expect(await repository.listCandidates("new")).toEqual([]);
    expect(await repository.listCandidates("ignored")).toMatchObject([
      { signalValue: "abcd1234", evidence: { appId: "lead" } },
    ]);
  });

  it("says nothing about an app with too few stores", async () => {
    const result = await mineAppSignals({ repository, minStores: 5 });

    expect(result.apps).toEqual([]);
    expect(result.candidates).toEqual([]);
  });
});
