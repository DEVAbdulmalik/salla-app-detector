import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportKnowledge, parseBackup, restoreKnowledge } from "./backup";
import type { Database } from "./db/executor";
import { KnowledgeRepository } from "./db/repository";
import { migrate } from "./db/migrate";
import { createEmbeddedDatabase } from "./db/pglite";

let source: Database;
let target: Database;

beforeEach(async () => {
  source = await createEmbeddedDatabase();
  target = await createEmbeddedDatabase();
  await migrate(source);
  await migrate(target);
});

afterEach(async () => {
  await source.close();
  await target.close();
});

async function curated(repository: KnowledgeRepository): Promise<void> {
  await repository.upsertApps([{ id: "347973230", name: "زر واتساب" }]);
  await repository.upsertFingerprints([
    {
      id: "mined:inline-signature:a78834ef",
      kind: "inline-signature",
      pattern: "a78834ef",
      strength: "strong",
      source: "mined",
      appId: "347973230",
    },
    {
      id: "auto:domain:vendor.example",
      kind: "domain",
      pattern: "vendor.example",
      strength: "strong",
      source: "auto",
      appId: "347973230",
    },
  ]);
  await repository.upsertNoiseRules([
    { kind: "inlineSignatures", pattern: "e445e263", reason: "generic tag manager loader" },
    { kind: "domains", pattern: "seeded.example", reason: "seed" },
  ]);
  await repository.upsertCandidates([
    { signalKind: "service", signalValue: "tiktok_pixel", storeCount: 32 },
    { signalKind: "domain", signalValue: "open.example", storeCount: 5 },
  ]);
  await repository.setCandidateStatus("service", "tiktok_pixel", "ignored");
  await repository.upsertCanaries([
    { storeUrl: "https://fuelupstore.com/", expectedAppIds: ["347973230"], expectedServices: [] },
  ]);
  await repository.recordGroundTruth([{ appId: "347973230", storeId: 101 }]);
}

describe("knowledge backup", () => {
  it("keeps what people decided and leaves out what a sync rebuilds", async () => {
    const repository = new KnowledgeRepository(source);
    await curated(repository);

    const backup = await exportKnowledge(repository, new Date("2026-09-25T00:00:00Z"));

    expect(backup.fingerprints.map((f) => f.id)).toEqual(["mined:inline-signature:a78834ef"]);
    expect(backup.noise.map((n) => n.pattern)).toEqual(["e445e263"]);
    expect(backup.candidates.map((c) => [c.signalValue, c.status])).toEqual([
      ["open.example", "new"],
      ["tiktok_pixel", "ignored"],
    ]);
    expect(backup.canaries).toHaveLength(1);
    expect(backup.groundTruth).toEqual([{ appId: "347973230", storeId: 101 }]);
  });

  it("brings a fresh database back to the same decisions", async () => {
    const original = new KnowledgeRepository(source);
    await curated(original);
    const backup = await exportKnowledge(original);

    // A new database only has the catalogue, as it would after `db import` and a sync.
    const restored = new KnowledgeRepository(target);
    await restored.upsertApps([{ id: "347973230", name: "زر واتساب" }]);
    await restoreKnowledge(restored, parseBackup(JSON.parse(JSON.stringify(backup))));

    const again = await exportKnowledge(restored, new Date(backup.exportedAt));
    expect(again).toEqual(backup);
  });

  it("refuses a file that is not a backup before writing anything", () => {
    expect(() => parseBackup({ format: 2 })).toThrow("unsupported backup format: 2");
    expect(() => parseBackup({ format: 1, fingerprints: [] })).toThrow("missing its noise");
    expect(() => parseBackup("hello")).toThrow("not a knowledge backup");
  });

  it("changes nothing when the same backup is restored twice", async () => {
    const repository = new KnowledgeRepository(source);
    await curated(repository);
    const backup = await exportKnowledge(repository);

    await restoreKnowledge(repository, backup);
    await restoreKnowledge(repository, backup);

    expect(await exportKnowledge(repository, new Date(backup.exportedAt))).toEqual(backup);
  });
});
